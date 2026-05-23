import Foundation
import UIKit
import CoreLocation
import UserNotifications

@objc(LocationManager)
class LocationManager: NSObject, CLLocationManagerDelegate, UNUserNotificationCenterDelegate {
    private let locationManager = CLLocationManager()
    private let supabaseUrl: String
    private let supabaseAnonKey: String
    private var userId: String?
    private var authToken: String?
    private var proximityCooldowns: [String: Date] = [:]
    private var trackingEnabled: Bool = true
    private var stealthMode: Bool = false
    private var proximityRadiusKm: Double = 5.0
    private var proximityAlertsEnabled: Bool = true
    private var heartbeatTimer: DispatchSourceTimer?
    private let heartbeatInterval: TimeInterval = 60 // 1 minute — fast enough for the 3-min online threshold
    private var lastHeartbeatTime: Date = .distantPast
    private var isInBackground: Bool = false
    private var lastKnownLocation: CLLocation?
    private var isGPSEnabledByMovement = false
    private var gpsWindowTimer: DispatchSourceTimer?
    private let gpsWindowDuration: TimeInterval = 15 // seconds to keep GPS active after movement
    private var currentUserName: String?

    // Background wiggle timer: periodically restarts location updates to force iOS
    // to deliver at least one location callback even for stationary devices.
    private var backgroundWiggleTimer: DispatchSourceTimer?
    private let backgroundWiggleInterval: TimeInterval = 180 // 3 minutes

    // Track the background task used for the initial grace-period heartbeats
    private var bgGraceTaskId: UIBackgroundTaskIdentifier = .invalid

    // CLServiceSession (iOS 17+) — required for background location to work in release builds
    private var serviceSession: AnyObject?

    // Debug logging — sends events to Supabase so we can monitor iOS background behavior
    // without needing Xcode console. Visible in Supabase Dashboard → profiles.last_debug_event
    private var lastDebugLogTime: Date = .distantPast
    private let debugLogThrottle: TimeInterval = 10 // Only log once per 10 seconds to avoid flooding

    override init() {
        // Read Supabase config from Info.plist, with HARDCODED fallbacks.
        // If Bundle.main.object(forInfoDictionaryKey:) returns nil (which can happen
        // in certain build configurations), ALL network calls silently fail because
        // URL(string: "") returns nil. The early return also skipped locationManager
        // setup, killing ALL native tracking. We MUST NOT return early.
        let bundleUrl = Bundle.main.object(forInfoDictionaryKey: "SupabaseUrl") as? String
        let bundleKey = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String
        supabaseUrl = bundleUrl?.isEmpty == false ? bundleUrl! : "https://vzlbvknauwvrqwpvtaqe.supabase.co"
        supabaseAnonKey = bundleKey?.isEmpty == false ? bundleKey! : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6bGJ2a25hdXd2cnF3cHZ0YXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NzUwODUsImV4cCI6MjA4NDQ1MTA4NX0.XlPQBEKzv-RxOnTD1pbS-5A_J5xavLqwpWH9IAC5kOw"
        if bundleUrl == nil || bundleUrl!.isEmpty {
            NSLog("[LocationManager] ⚠️ SupabaseUrl NOT found in Info.plist — using hardcoded fallback")
        }
        if bundleKey == nil || bundleKey!.isEmpty {
            NSLog("[LocationManager] ⚠️ SupabaseAnonKey NOT found in Info.plist — using hardcoded fallback")
        }
        super.init()

        locationManager.delegate = self
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = false
        locationManager.pausesLocationUpdatesAutomatically = true
        locationManager.activityType = .otherNavigation

        // iOS 18+ requires CLServiceSession for background location in release builds
        if #available(iOS 18.0, *) {
            serviceSession = CLServiceSession(authorization: .always)
            NSLog("[LocationManager] CLServiceSession created (iOS 18+)")
        }

        // Listen for foreground/background transitions natively so we don't
        // depend on the Capacitor JS bridge (which is suspended in background).
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillTerminate), name: UIApplication.willTerminateNotification, object: nil)
    }

    func startLocationUpdates(userId: String, authToken: String) {
        self.userId = userId
        self.authToken = authToken

        // Diagnostic: log whether supabaseUrl was loaded correctly
        NSLog("[LocationManager] startLocationUpdates called — supabaseUrl='\(supabaseUrl)', supabaseAnonKey count=\(supabaseAnonKey.count)")

        // Set up notification delegate for foreground notifications
        UNUserNotificationCenter.current().delegate = self

        // Request notification permission for proximity alerts
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                NSLog("[LocationManager] Notification permission error: \(error)")
            }
            NSLog("[LocationManager] Notification permission granted: \(granted)")
        }

        // Request "Always" authorization — this is CRITICAL for background tracking.
        // Without "Always", location updates stop when the app is suspended.
        let status = CLLocationManager.authorizationStatus()
        if status == .notDetermined {
            locationManager.requestAlwaysAuthorization()
        } else if status == .authorizedWhenInUse {
            // On iOS 13+, upgrade to "Always" requires going to Settings
            // Request again — iOS may show the upgrade prompt
            locationManager.requestAlwaysAuthorization()
        }

        // Configure for continuous background tracking:
        // - kCLLocationAccuracyNearestTenMeters in background prevents iOS throttling
        // - kCLLocationAccuracyBest in foreground for precise tracking
        // - distanceFilter = kCLDistanceFilterNone = report every GPS update
        if isInBackground {
            locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            locationManager.distanceFilter = kCLDistanceFilterNone
        } else {
            locationManager.desiredAccuracy = kCLLocationAccuracyBest
            locationManager.distanceFilter = kCLDistanceFilterNone
        }

        locationManager.startUpdatingLocation()
        // Significant location changes work even when the app is terminated.
        // iOS relaunches the app with launchOptions[.location] when a significant change occurs.
        locationManager.startMonitoringSignificantLocationChanges()
        // Visit monitoring delivers callbacks even for stationary devices when iOS
        // detects place transitions. Provides an additional heartbeat trigger.
        locationManager.startMonitoringVisits()

        // IMMEDIATELY write a debug event to confirm native code is running
        // This does NOT use sendDebugLog (which might fail silently)
        // Include build number so we can verify which build is actually running
        writeImmediateDebugEvent("native_v40_start", userId: userId)

        // Start heartbeat timer immediately.
        // Note: this timer SUSPENDS when the app is suspended. It only fires
        // when the app is in the foreground or briefly awakened by location updates.
        // The PRIMARY heartbeat mechanism is didUpdateLocations.
        startHeartbeatTimer()

        // Send an immediate heartbeat to confirm we're online
        sendHeartbeatNow()

        // Load profile settings
        loadProfileSettings()

        NSLog("[LocationManager] Location updates started for userId=\(userId), authStatus=\(status.rawValue)")
        sendDebugLog("start_location_updates", details: "authStatus=\(status.rawValue)")
    }

    func stopLocationUpdates() {
        locationManager.stopUpdatingLocation()
        locationManager.stopMonitoringSignificantLocationChanges()
        locationManager.stopMonitoringVisits()
        stopHeartbeatTimer()
        stopBackgroundWiggleTimer()
        userId = nil
        authToken = nil
    }

    /// Update auth token from JS bridge (called on every onAuthStateChange and app foreground resume)
    func updateAuthToken(authToken: String, userId: String? = nil) {
        self.authToken = authToken
        if let userId = userId {
            self.userId = userId
        }
        // Persist to UserDefaults so subsequent reads and 401 recovery find the fresh token
        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
        if let jsonString = UserDefaults.standard.string(forKey: key),
           let jsonData = jsonString.data(using: .utf8),
           var storedSession = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
            storedSession["access_token"] = authToken
            if let userId = userId,
               var userObj = storedSession["user"] as? [String: Any] {
                userObj["id"] = userId
                storedSession["user"] = userObj
            }
            if let updatedData = try? JSONSerialization.data(withJSONObject: storedSession),
               let updatedString = String(data: updatedData, encoding: .utf8) {
                UserDefaults.standard.set(updatedString, forKey: key)
            }
        }
        NSLog("[LocationManager] Auth token updated from JS bridge (persisted)")
    }

    /// Read UserDefaults for a newer access_token than the current authToken.
    /// Returns true if the token was updated.
    private func updateTokenFromStorage() -> Bool {
        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
        guard let jsonString = UserDefaults.standard.string(forKey: key),
              let jsonData = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let storedAccessToken = json["access_token"] as? String,
              storedAccessToken != authToken else {
            return false
        }
        authToken = storedAccessToken
        NSLog("[LocationManager] Token updated from storage")
        return true
    }

    func setTrackingEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
        if enabled {
            locationManager.startUpdatingLocation()
            locationManager.startMonitoringSignificantLocationChanges()
            locationManager.startMonitoringVisits()
            startHeartbeatTimer()
            sendHeartbeatNow()
        } else {
            locationManager.stopUpdatingLocation()
            locationManager.stopMonitoringSignificantLocationChanges()
            locationManager.stopMonitoringVisits()
            stopHeartbeatTimer()
            // Don't set last_heartbeat_at to null — let it expire naturally on server
            NSLog("[LocationManager] Tracking disabled — heartbeat will expire naturally")
        }
    }

    /// Set stealth mode: hides the user's location from other users but keeps
    /// heartbeats running so the user still appears "online". This matches the
    /// Android behavior where stealth only skips updateLocationInSupabase().
    func setStealthMode(_ enabled: Bool) {
        stealthMode = enabled
        NSLog("[LocationManager] Stealth mode: \(enabled) — heartbeats continue regardless")
        sendDebugLog("stealth_mode_changed", details: "enabled=\(enabled)")
    }

    // MARK: - Authorization

    func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        NSLog("[LocationManager] Authorization changed to: \(status.rawValue)")

        if status == .authorizedAlways {
            // Great — full background tracking is available
            if userId != nil {
                locationManager.startUpdatingLocation()
                locationManager.startMonitoringSignificantLocationChanges()
            }
        } else if status == .authorizedWhenInUse {
            // User only granted "When In Use" — background tracking will stop when app is suspended
            // We need "Always" for reliable background tracking
            NSLog("[LocationManager] WARNING: Only 'When In Use' authorization. Background tracking will be limited.")
            NSLog("[LocationManager] User must go to Settings > Fraterna > Location > Always to enable full background tracking")
            // Still start updates — they'll work while app is in foreground
            if userId != nil {
                locationManager.startUpdatingLocation()
                locationManager.startMonitoringSignificantLocationChanges()
            }
        } else if status == .denied || status == .restricted {
            NSLog("[LocationManager] Location authorization denied or restricted")
        }
    }

    // JS bridge calls these, but the native NotificationCenter observers
    // are the authoritative source for accuracy transitions.
    func setForegroundAccuracy() {
        isInBackground = false
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()
        locationManager.startMonitoringSignificantLocationChanges()
        locationManager.startMonitoringVisits()
        cancelGPSWindowTimer()
        isGPSEnabledByMovement = false
    }

    func setBackgroundAccuracy() {
        // "Pulse" mode: GPS at low accuracy in background.
        // iOS delivers callbacks while active, then PAUSES when device is stationary.
        // When paused, the arrow disappears and app may suspend.
        // Silent pushes from cron wake the app → brief GPS restart → heartbeat → pause again.
        isInBackground = true
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()
        locationManager.startMonitoringSignificantLocationChanges()
        locationManager.startMonitoringVisits()
    }

    // MARK: - Native foreground/background observers
    // These fire regardless of whether the Capacitor webview is alive.

    @objc func appDidEnterBackground() {
        isInBackground = true
        NSLog("[LocationManager] App entered background (native)")
        sendDebugLog("app_background", details: "switching_to_pulse_mode")
        if let uid = userId {
            writeImmediateDebugEvent("native_bg_v40", userId: uid)
        }

        // "Pulse" mode: GPS at low accuracy in background.
        // iOS delivers callbacks while active, then PAUSES when stationary.
        // pausesLocationUpdatesAutomatically = true → iOS pauses GPS → arrow disappears.
        // Silent pushes wake the app for brief GPS + heartbeat → arrow flashes → pause again.
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()

        // Keep significant location changes and visit monitoring as additional wakeup triggers
        locationManager.startMonitoringSignificantLocationChanges()
        locationManager.startMonitoringVisits()

        // Start heartbeat timer as backup (fires while app is alive, suspends with app)
        startHeartbeatTimer()

        // Send immediate heartbeat to maintain active status
        sendHeartbeatNow()

        NSLog("[LocationManager] Background mode: pulse GPS + significant changes + visits")
    }

    @objc func appDidBecomeActive() {
        isInBackground = false
        NSLog("[LocationManager] App became active (native)")
        sendDebugLog("app_foreground")

        // Restart full GPS for foreground
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()

        // Cancel any GPS window timer (we're in foreground now)
        cancelGPSWindowTimer()

        // Send immediate heartbeat
        sendHeartbeatNow()
    }

    @objc private func appWillTerminate() {
        NSLog("[LocationManager] App will terminate — saving state")
        // Don't stop location updates on termination.
        // startMonitoringSignificantLocationChanges will relaunch the app.
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        lastKnownLocation = location

        guard let userId = userId, trackingEnabled else { return }

        sendDebugLog("did_update_locations", details: "bg=\(isInBackground), accuracy=\(location.horizontalAccuracy)m, speed=\(location.speed)m/s")

        // PRIMARY heartbeat mechanism.
        // With continuous GPS (even at low accuracy), iOS delivers callbacks
        // every 1-3 min even for stationary devices. Each callback = heartbeat.

        // Protect network calls with a UIBackgroundTask so iOS doesn't
        // suspend the app before they complete.
        var bgTaskId: UIBackgroundTaskIdentifier = .invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "FraternaLocationUpdate") { [weak self] in
            // Expiration handler — iOS is about to suspend us. End cleanly.
            self?.endBackgroundTask(bgTaskId)
        }

        // Refresh token asynchronously, then send heartbeat + location update
        refreshTokenAsync { [weak self] in
            guard let self = self else {
                UIApplication.shared.endBackgroundTask(bgTaskId)
                return
            }
            guard let currentToken = self.authToken else {
                self.endBackgroundTask(bgTaskId)
                return
            }

            // Use DispatchGroup to wait for ALL network calls to complete
            // before ending the background task. Without this, iOS can suspend
            // the app before URLSession requests finish, causing heartbeats
            // to never reach the server.
            let group = DispatchGroup()

            group.enter()
            self.sendHeartbeat(userId: userId, authToken: currentToken) {
                group.leave()
            }

            group.enter()
            self.updateLocation(userId: userId, authToken: currentToken, location: location) {
                group.leave()
            }

            group.enter()
            self.checkProximityAlerts(userId: userId, authToken: currentToken, location: location) {
                group.leave()
            }

            // End background task only after all network calls complete
            group.notify(queue: .global(qos: .utility)) {
                self.endBackgroundTask(bgTaskId)
            }
        }
    }

    private func endBackgroundTask(_ taskId: UIBackgroundTaskIdentifier) {
        if taskId != .invalid {
            UIApplication.shared.endBackgroundTask(taskId)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("[LocationManager] Location error: \(error.localizedDescription)")
    }

    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        NSLog("[LocationManager] ⚠️ Location updates PAUSED by iOS (stationary device)")
        sendDebugLog("location_paused_by_ios")

        // Send a final heartbeat before app suspends — this buys us ~10 min of "online"
        sendHeartbeatNow()

        // Don't restart GPS here — the arrow disappears (what the user wants).
        // The app will be woken by: silent push, significant change, or visit.
        // When woken, AppDelegate calls sendHeartbeatNow() + brief GPS restart.
    }

    func locationManagerDidResumeLocationUpdates(_ manager: CLLocationManager) {
        NSLog("[LocationManager] Location updates resumed")
    }

    // MARK: - Visit Monitoring Delegate
    // Visit monitoring delivers callbacks even for stationary devices when iOS
    // detects place transitions (arriving/departing). This provides an additional
    // heartbeat trigger independent of didUpdateLocations.

    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        guard let userId = userId, trackingEnabled else { return }
        NSLog("[LocationManager] Visit detected at \(visit.coordinate), arriving: \(visit.arrivalDate), departing: \(visit.departureDate)")
        sendDebugLog("visit_detected", details: "arriving=\(visit.arrivalDate)")

        // Briefly switch to high accuracy for a fresh GPS fix on visit detection
        if isInBackground {
            locationManager.desiredAccuracy = kCLLocationAccuracyBest
            locationManager.distanceFilter = kCLDistanceFilterNone
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 10) { [weak self] in
                guard let self = self else { return }
                self.locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
                self.locationManager.distanceFilter = kCLDistanceFilterNone
            }
        }

        // Protect with UIBackgroundTask so iOS doesn't suspend before network completes
        var bgTaskId: UIBackgroundTaskIdentifier = .invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "VisitHeartbeat") { [weak self] in
            self?.endBackgroundTask(bgTaskId)
        }

        refreshTokenAsync { [weak self] in
            guard let self = self, let token = self.authToken else {
                UIApplication.shared.endBackgroundTask(bgTaskId)
                return
            }
            self.sendHeartbeat(userId: userId, authToken: token) {
                UIApplication.shared.endBackgroundTask(bgTaskId)
            }
        }
    }

    // MARK: - Background Wiggle Timer
    // Backup mechanism: briefly restarts location updates with high accuracy
    // every 3 minutes to force a fresh GPS fix. This supplements the continuous
    // low-accuracy GPS that's now the primary background mechanism.

    private func startBackgroundWiggleTimer() {
        // Don't restart if already running
        if backgroundWiggleTimer != nil { return }
        guard userId != nil else { return }

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + backgroundWiggleInterval, repeating: backgroundWiggleInterval, leeway: .seconds(30))
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            NSLog("[LocationManager] Background wiggle: forcing high-accuracy refresh")
            self.sendDebugLog("bg_wiggle_refresh")

            // Briefly switch to high accuracy for a fresh GPS fix, then back to low
            self.locationManager.desiredAccuracy = kCLLocationAccuracyBest
            self.locationManager.distanceFilter = kCLDistanceFilterNone

            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5) { [weak self] in
                guard let self = self else { return }
                self.locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
                self.locationManager.distanceFilter = kCLDistanceFilterNone
            }

            // Also send a direct heartbeat
            self.sendHeartbeatNow()

            // Check proximity alerts using lastKnownLocation
            if let lastLoc = self.lastKnownLocation {
                self.sendProximityCheck(location: lastLoc)
            }
        }
        timer.resume()
        backgroundWiggleTimer = timer
        NSLog("[LocationManager] Background wiggle timer started (every \(Int(backgroundWiggleInterval))s)")
        sendDebugLog("wiggle_timer_started")
    }

    private func stopBackgroundWiggleTimer() {
        backgroundWiggleTimer?.cancel()
        backgroundWiggleTimer = nil
    }

    // MARK: - GPS Window for Movement Detection
    // When a significant location change or visit is detected in background,
    // briefly start GPS to get precise location for proximity checks and heartbeat.

    private func startGPSWindowForMovement() {
        guard isInBackground else { return }

        NSLog("[LocationManager] Starting GPS window for movement detection (15s)")
        sendDebugLog("gps_window_start", details: "movement_detected")

        isGPSEnabledByMovement = true
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()

        // Cancel existing timer if any
        cancelGPSWindowTimer()

        // Schedule timer to stop GPS after the window duration
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + gpsWindowDuration, leeway: .seconds(2))
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.endGPSWindow()
        }
        timer.resume()
        gpsWindowTimer = timer
    }

    private func endGPSWindow() {
        guard isInBackground else { return }

        NSLog("[LocationManager] Ending GPS window — switching to significant changes only")
        sendDebugLog("gps_window_end", details: "stopping_gps")
        isGPSEnabledByMovement = false
        locationManager.stopUpdatingLocation()

        // Keep significant location changes and visits active
        locationManager.startMonitoringSignificantLocationChanges()
        locationManager.startMonitoringVisits()
    }

    private func cancelGPSWindowTimer() {
        gpsWindowTimer?.cancel()
        gpsWindowTimer = nil
    }

    // MARK: - Heartbeat Timer
    // This timer ONLY fires when the app is not suspended (foreground or briefly
    // awakened by location updates). It's a backup for the primary mechanism
    // (didUpdateLocations). The timer interval is 60 seconds.

    private func startHeartbeatTimer() {
        // Don't restart if already running
        if heartbeatTimer != nil { return }

        guard userId != nil else { return }

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + heartbeatInterval, repeating: heartbeatInterval, leeway: .seconds(5))
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.refreshTokenAsync { [weak self] in
                guard let self = self, let userId = self.userId, let token = self.authToken else {
                    return
                }
                self.sendHeartbeat(userId: userId, authToken: token)
            }
        }
        timer.resume()
        heartbeatTimer = timer
        NSLog("[LocationManager] Heartbeat timer started (every \(heartbeatInterval)s)")
    }

    private func stopHeartbeatTimer() {
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
    }

    /// Send heartbeat immediately (not from timer). Used on app resume, start,
    /// and by AppDelegate when woken by silent push / background fetch.
    @objc func sendHeartbeatNow() {
        guard let userId = userId else { return }
        refreshTokenAsync { [weak self] in
            guard let self = self, let token = self.authToken else { return }
            self.sendHeartbeat(userId: userId, authToken: token)
            // Also check proximity on every heartbeat cycle
            if let lastLoc = self.lastKnownLocation {
                self.checkProximityAlerts(userId: userId, authToken: token, location: lastLoc)
            }
        }
    }

    /// Called when the app is woken by a push notification or BGProcessingTask.
    /// Uses lastKnownLocation if available, or starts a brief GPS window.
    func sendProximityCheckFromPush() {
        guard let userId = userId else { return }
        if let location = lastKnownLocation {
            sendProximityCheck(location: location)
        } else if isInBackground {
            // No last location — briefly start GPS to get one
            locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            locationManager.distanceFilter = kCLDistanceFilterNone
            locationManager.startUpdatingLocation()
        }
    }

    // MARK: - Pulse Location Update
    // Briefly restarts GPS at low accuracy when woken by silent push.
    // This forces iOS to deliver at least one location callback → heartbeat.
    // After the callback, iOS will pause GPS again when stationary (arrow disappears).
    // This creates the "intermittent" pattern the user wants.

    @objc func pulseLocationUpdate() {
        guard isInBackground else { return }

        NSLog("[LocationManager] Pulse: briefly restarting GPS for heartbeat")
        sendDebugLog("pulse_gps_start")

        // Restart GPS at low accuracy — iOS will deliver a callback
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()

        // After 10 seconds, let iOS pause again (if stationary).
        // 10s is enough for iOS to get a WiFi/cell fix and call didUpdateLocations.
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self else { return }
            // Don't explicitly stop — let pausesLocationUpdatesAutomatically handle it.
            // iOS will pause when it detects no movement, making the arrow disappear.
            self.sendDebugLog("pulse_gps_end")
        }
    }

    /// Send proximity check using lastKnownLocation. Called by wiggle timer
    /// and on app resume when didUpdateLocations may not fire.
    private func sendProximityCheck(location: CLLocation) {
        guard let userId = userId else { return }
        refreshTokenAsync { [weak self] in
            guard let self = self, let token = self.authToken else { return }
            self.checkProximityAlerts(userId: userId, authToken: token, location: location)
        }
    }

    // MARK: - Token Refresh
    // Tries in order:
    // 1. Check UserDefaults for a token newer than current (written by JS client)
    // 2. If current token is expired, attempt native Supabase refresh using the
    //    refresh_token from UserDefaults. This works in background because
    //    the JS webview is suspended and hasn't consumed the refresh_token.

    private func refreshTokenAsync(completion: @escaping () -> Void) {
        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
        guard let jsonString = UserDefaults.standard.string(forKey: key),
              let jsonData = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            completion()
            return
        }

        // Check if JS client already refreshed the token in storage
        if let storedAccessToken = json["access_token"] as? String,
           storedAccessToken != authToken {
            authToken = storedAccessToken
            NSLog("[LocationManager] Token updated from storage (JS client refreshed)")
        }

        // Fallback: if current token is expired, try native Supabase refresh
        if let currentToken = authToken, isTokenExpired(currentToken) {
            NSLog("[LocationManager] Token expired, attempting native Supabase refresh...")
            if let refreshTokenStr = json["refresh_token"] as? String {
                performTokenRefreshAsync(refreshToken: refreshTokenStr, completion: completion)
            } else {
                NSLog("[LocationManager] No refresh_token found in stored session")
                completion()
            }
        } else {
            completion()
        }
    }

    private func isTokenExpired(_ token: String) -> Bool {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return true }

        var base64 = String(parts[1])
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }

        guard let payloadData = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let exp = payload["exp"] as? TimeInterval else {
            return true
        }

        let nowSeconds = Date().timeIntervalSince1970
        return nowSeconds >= exp
    }

    private func performTokenRefreshAsync(refreshToken: String, completion: @escaping () -> Void) {
        let urlString = "\(supabaseUrl)/auth/v1/token?grant_type=refresh_token"
        guard let url = URL(string: urlString) else {
            completion()
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["refresh_token": refreshToken]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else {
                completion()
                return
            }

            guard let data = data, error == nil,
                  let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                let errorBody = data.flatMap { String(data: $0, encoding: .utf8)?.prefix(200) }.map(String.init) ?? "no body"
                NSLog("[LocationManager] Native token refresh failed: \(statusCode) - \(errorBody)")
                completion()
                return
            }

            do {
                guard let newSession = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let newAccessToken = newSession["access_token"] as? String else {
                    completion()
                    return
                }

                self.authToken = newAccessToken
                NSLog("[LocationManager] ✓ Token refreshed via Supabase (native)")
                self.sendDebugLog("token_refreshed")

                if let userObj = newSession["user"] as? [String: Any],
                   let newUserId = userObj["id"] as? String {
                    self.userId = newUserId
                }

                // Write the complete new session to UserDefaults
                // so the JS client can pick it up on resume
                let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
                if let jsonString = UserDefaults.standard.string(forKey: key),
                   let jsonData = jsonString.data(using: .utf8),
                   var storedSession = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {

                    storedSession["access_token"] = newAccessToken
                    if let newRefreshToken = newSession["refresh_token"] as? String {
                        storedSession["refresh_token"] = newRefreshToken
                    }
                    storedSession["expires_at"] = newSession["expires_at"]
                    storedSession["expires_in"] = newSession["expires_in"]
                    storedSession["token_type"] = "bearer"

                    if let updatedData = try? JSONSerialization.data(withJSONObject: storedSession),
                       let updatedString = String(data: updatedData, encoding: .utf8) {
                        UserDefaults.standard.set(updatedString, forKey: key)
                        NSLog("[LocationManager] New session written to UserDefaults")
                    }
                }
            } catch {
                NSLog("[LocationManager] Error parsing refresh response: \(error)")
            }
            completion()
        }.resume()
    }

    // MARK: - Profile Settings

    private func loadProfileSettings() {
        guard let userId = userId else { return }
        refreshTokenAsync { [weak self] in
            guard let self = self, let token = self.authToken else { return }

            let urlString = "\(self.supabaseUrl)/rest/v1/profiles?id=eq.\(userId)&select=proximity_radius_km,proximity_alerts_enabled,stealth_mode,tracking_enabled,full_name"
            guard let url = URL(string: urlString) else { return }
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue(self.supabaseAnonKey, forHTTPHeaderField: "apikey")

            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                guard let self = self, let data = data, error == nil else { return }
                do {
                    guard let profiles = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
                          let profile = profiles.first else { return }

                    // Update tracking settings from server
                    if let tracking = profile["tracking_enabled"] as? Bool {
                        self.trackingEnabled = tracking
                        if tracking {
                            self.locationManager.startUpdatingLocation()
                            self.locationManager.startMonitoringSignificantLocationChanges()
                            self.startHeartbeatTimer()
                        } else {
                            self.locationManager.stopUpdatingLocation()
                            self.locationManager.stopMonitoringSignificantLocationChanges()
                            self.stopHeartbeatTimer()
                        }
                    }
                    // Stealth mode: hide location from other users but KEEP heartbeats running.
                    // This matches the Android behavior where stealth mode only skips
                    // updateLocationInSupabase() but sendHeartbeat() always fires.
                    // The user should appear "online" even in stealth mode — they just
                    // won't show their position on the map.
                    // NOTE: We do NOT stop locationManager or heartbeatTimer here.
                    // The stealth flag is checked in updateLocation() to skip the upload.
                    if let stealth = profile["stealth_mode"] as? Bool {
                        self.stealthMode = stealth
                        NSLog("[LocationManager] Stealth mode: \(stealth) — heartbeats continue regardless")
                    }
                    if let radius = jsonDouble(profile, key: "proximity_radius_km") {
                        self.proximityRadiusKm = radius
                    }
                    if let alerts = profile["proximity_alerts_enabled"] as? Bool {
                        self.proximityAlertsEnabled = alerts
                    }
                    if let name = profile["full_name"] as? String {
                        self.currentUserName = name
                    }
                } catch {
                    NSLog("[LocationManager] Error loading profile settings: \(error)")
                }
            }.resume()
        }
    }

    // MARK: - Heartbeat

    /// Convenience overload without completion handler (used by heartbeat timer and sendHeartbeatNow)
    private func sendHeartbeat(userId: String, authToken: String) {
        sendHeartbeat(userId: userId, authToken: authToken, completion: nil)
    }

    /// Send heartbeat with optional completion handler for DispatchGroup coordination
    private func sendHeartbeat(userId: String, authToken: String, completion: (() -> Void)?) {
        // Throttle: don't send more than once per 30 seconds
        let now = Date()
        guard now.timeIntervalSince(lastHeartbeatTime) >= 30 else {
            NSLog("[LocationManager] Heartbeat throttled (sent \(Int(now.timeIntervalSince(lastHeartbeatTime)))s ago)")
            completion?()
            return
        }
        lastHeartbeatTime = now

        let urlStr = "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)"
        guard let url = URL(string: urlStr) else {
            NSLog("[LocationManager] ⚠️ sendHeartbeat: INVALID URL — supabaseUrl='\(supabaseUrl)'")
            completion?()
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let body: [String: Any] = ["last_heartbeat_at": formatter.string(from: Date())]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            if let httpResponse = response as? HTTPURLResponse {
                if httpResponse.statusCode == 200 || httpResponse.statusCode == 204 {
                    NSLog("[LocationManager] ✓ Heartbeat sent")
                    self?.sendDebugLog("heartbeat_ok_v39", details: "bg=\(self?.isInBackground ?? false)")
                    if let uid = self?.userId {
                        self?.writeImmediateDebugEvent("native_hb_v39_\(self?.isInBackground == true ? "bg" : "fg")", userId: uid)
                    }
                } else {
                    NSLog("[LocationManager] ✗ Heartbeat failed: \(httpResponse.statusCode)")
                    if httpResponse.statusCode == 401 {
                        NSLog("[LocationManager] Got 401, attempting token refresh...")
                        self?.refreshTokenAsync { [weak self] in
                            guard let self = self, let newToken = self.authToken, newToken != authToken else {
                                NSLog("[LocationManager] Could not refresh token after 401, next cycle will retry")
                                return
                            }
                            // Retry once with the new token
                            self.sendHeartbeat(userId: userId, authToken: newToken)
                        }
                    }
                }
            }
            completion?()
        }.resume()
    }

    // MARK: - Location Update

    private func updateLocation(userId: String, authToken: String, location: CLLocation, completion: (() -> Void)? = nil) {
        // Check privacy flags — if stealth mode or tracking disabled, skip upload
        // but still allow heartbeats to keep the user "online" if they want to appear online
        if stealthMode || !trackingEnabled {
            NSLog("[LocationManager] Skipping location upload: stealth=\(stealthMode), tracking=\(trackingEnabled)")
            completion?()
            return
        }

        guard let url = URL(string: "\(supabaseUrl)/rest/v1/locations?on_conflict=user_id") else {
            NSLog("[LocationManager] ⚠️ updateLocation: INVALID URL — supabaseUrl='\(supabaseUrl)'")
            completion?()
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")

        let clampedAccuracy = max(100, min(300, Int(location.horizontalAccuracy.rounded())))
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let body: [String: Any] = [
            "user_id": userId,
            "lat": location.coordinate.latitude,
            "lng": location.coordinate.longitude,
            "accuracy_meters": clampedAccuracy,
            "updated_at": formatter.string(from: Date())
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { _, response, error in
            if let httpResponse = response as? HTTPURLResponse {
                if httpResponse.statusCode == 200 || httpResponse.statusCode == 201 || httpResponse.statusCode == 204 {
                    NSLog("[LocationManager] ✓ Location updated")
                    self.sendDebugLog("location_updated")
                } else {
                    NSLog("[LocationManager] ✗ Location update failed: \(httpResponse.statusCode)")
                }
            }
            completion?()
        }.resume()
    }

    // MARK: - Proximity Alerts

    /// Safely extract a Double from JSON — handles both Int and Double NSNumber
    /// because PostgREST returns int4 columns as JSON integers (e.g., 1 not 1.0)
    private func jsonDouble(_ dict: [String: Any], key: String) -> Double? {
        if let d = dict[key] as? Double { return d }
        if let i = dict[key] as? Int { return Double(i) }
        return nil
    }

    private func checkProximityAlerts(userId: String, authToken: String, location: CLLocation, completion: (() -> Void)? = nil) {
        guard proximityAlertsEnabled else {
            completion?()
            return
        }

        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let radius = proximityRadiusKm * 0.01

        let urlString = "\(supabaseUrl)/rest/v1/locations?select=user_id,lat,lng,profile:profiles!locations_user_id_fkey(id,full_name,tracking_enabled,stealth_mode,last_heartbeat_at,proximity_alerts_enabled,proximity_radius_km)&lat=not.is.null&lng=not.is.null&user_id=neq.\(userId)&lat=gt.\(lat - radius)&lat=lt.\(lat + radius)&lng=gt.\(lng - radius)&lng=lt.\(lng + radius)"

        guard let url = URL(string: urlString) else {
            NSLog("[LocationManager] ⚠️ checkProximityAlerts: INVALID URL")
            completion?()
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else {
                completion?()
                return
            }

            if let error = error {
                NSLog("[LocationManager] Proximity query error: \(error.localizedDescription)")
                self.sendDebugLog("proximity_error", details: error.localizedDescription.prefix(100).description)
                completion?()
                return
            }

            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if statusCode == 401 {
                NSLog("[LocationManager] Proximity query got 401, refreshing token and retrying...")
                self.sendDebugLog("proximity_401_retry", details: "refreshing")
                self.refreshTokenAsync { [weak self] in
                    guard let self = self, let newToken = self.authToken, newToken != authToken else {
                        NSLog("[LocationManager] Proximity 401 retry: could not refresh token")
                        completion?()
                        return
                    }
                    self.checkProximityAlerts(userId: userId, authToken: newToken, location: location, completion: completion)
                }
                return
            }
            if statusCode >= 400 {
                let body = data.flatMap { String(data: $0, encoding: .utf8)?.prefix(200) }.map(String.init) ?? "no body"
                NSLog("[LocationManager] Proximity query failed: \(statusCode) - \(body)")
                self.sendDebugLog("proximity_http_error", details: "status=\(statusCode)")
                completion?()
                return
            }

            guard let data = data else {
                NSLog("[LocationManager] Proximity query: no data")
                completion?()
                return
            }

            // Also refresh profile settings periodically
            self.loadProfileSettings()

            do {
                guard let locationEntries = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                    NSLog("[LocationManager] Proximity query: not an array")
                    completion?()
                    return
                }
                NSLog("[LocationManager] Proximity query returned \(locationEntries.count) entries")
                self.sendDebugLog("proximity_results", details: "count=\(locationEntries.count)")
                for entry in locationEntries {
                    self.processProximityAlert(myLocation: location, entry: entry)
                }
            } catch {
                NSLog("[LocationManager] Proximity parse error: \(error)")
                self.sendDebugLog("proximity_parse_error", details: error.localizedDescription.prefix(100).description)
            }
            completion?()
        }.resume()
    }

    private func processProximityAlert(myLocation: CLLocation, entry: [String: Any]) {
        guard let theirLat = entry["lat"] as? Double,
              let theirLng = entry["lng"] as? Double else {
            NSLog("[LocationManager] Proximity: missing lat/lng in entry")
            return
        }

        guard let profile = entry["profile"] as? [String: Any],
              let profileId = profile["id"] as? String else {
            NSLog("[LocationManager] Proximity: missing profile or profile.id — entry keys: \(entry.keys)")
            sendDebugLog("proximity_no_profile", details: "keys=\(entry.keys.joined(separator: ",").prefix(80))")
            return
        }

        // Skip self — never notify about your own location
        if let myId = userId, profileId == myId {
            NSLog("[LocationManager] Proximity: skipping self (profileId=\(profileId.prefix(8)), myId=\(myId.prefix(8)))")
            return
        }

        let theirTracking = profile["tracking_enabled"] as? Bool ?? false
        if !theirTracking {
            NSLog("[LocationManager] Proximity: \(profileId) tracking disabled")
            return
        }

        let theirStealth = profile["stealth_mode"] as? Bool ?? false
        if theirStealth {
            NSLog("[LocationManager] Proximity: \(profileId) stealth mode")
            return
        }

        guard let lastHeartbeat = profile["last_heartbeat_at"] as? String else {
            NSLog("[LocationManager] Proximity: \(profileId) no last_heartbeat_at")
            return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let heartbeatDate = formatter.date(from: lastHeartbeat) else {
            NSLog("[LocationManager] Proximity: \(profileId) invalid heartbeat date")
            return
        }
        let tenMinAgo = Date().addingTimeInterval(-600)
        guard heartbeatDate > tenMinAgo else {
            NSLog("[LocationManager] Proximity: \(profileId) heartbeat too old")
            return
        }

        let theirLocation = CLLocation(latitude: theirLat, longitude: theirLng)
        let distance = myLocation.distance(from: theirLocation) / 1000.0

        let theirRadius = jsonDouble(profile, key: "proximity_radius_km") ?? 5.0
        let theirAlerts = profile["proximity_alerts_enabled"] as? Bool ?? true
        let myRadius = proximityRadiusKm
        let alertRadius = min(myRadius, theirRadius)

        guard distance <= alertRadius, theirAlerts else {
            NSLog("[LocationManager] Proximity: \(profileId) distance=\(String(format: "%.2f", distance))km > radius=\(alertRadius)km or theirAlerts=\(theirAlerts)")
            return
        }

        if let lastAlert = proximityCooldowns[profileId],
           Date().timeIntervalSince(lastAlert) < 300 {
            NSLog("[LocationManager] Proximity: \(profileId) cooldown active")
            return
        }

        proximityCooldowns[profileId] = Date()
        let fullName = profile["full_name"] as? String ?? "Un QH hermano"
        NSLog("[LocationManager] ✓ SENDING proximity notification for \(profileId) at \(String(format: "%.2f", distance))km")
        sendDebugLog("proximity_sent", details: "id=\(profileId.prefix(8)), dist=\(String(format: "%.2f", distance))km")
        sendProximityNotification(profileId: profileId, fullName: fullName, distance: distance)
        sendProximityPushNotification(toUserId: profileId, distance: distance)
    }

    private func sendProximityNotification(profileId: String, fullName: String, distance: Double) {
        let content = UNMutableNotificationContent()
        content.title = "QH Cerca"
        if distance < 1.0 {
            content.body = String(format: "%@ está a %.0f m de ti", fullName, distance * 1000)
        } else {
            content.body = String(format: "%@ está a %.1f km de ti", fullName, distance)
        }
        content.sound = .default
        content.categoryIdentifier = "proximity"

        let request = UNNotificationRequest(identifier: "proximity-\(profileId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func sendProximityPushNotification(toUserId: String, distance: Double) {
        guard let authToken = authToken, let myUserId = userId else { return }
        let fromName = currentUserName ?? "Un QH"

        let urlString = "\(supabaseUrl)/functions/v1/send-push-notification"
        guard let url = URL(string: urlString) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "type": "proximity_alert",
            "data": [
                "from_user_id": myUserId,
                "from_name": fromName,
                "to_user_id": toUserId
            ]
        ]

        guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else { return }
        request.httpBody = httpBody

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                NSLog("[LocationManager] Proximity push error: \(error.localizedDescription)")
                return
            }
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if statusCode >= 200 && statusCode < 300 {
                NSLog("[LocationManager] ✓ Proximity push sent to \(toUserId.prefix(8))")
                self.sendDebugLog("proximity_push_sent", details: "to=\(toUserId.prefix(8))")
            } else {
                NSLog("[LocationManager] Proximity push failed: \(statusCode)")
                self.sendDebugLog("proximity_push_error", details: "status=\(statusCode)")
            }
        }.resume()
    }

    // MARK: - Debug Logging
    // Sends debug events to Supabase profiles.last_debug_event column.
    // Uses the anon key as auth fallback when user token isn't available yet.
    // Throttled to once per 10 seconds to avoid flooding.

    private func sendDebugLog(_ event: String, details: String? = nil) {
        let now = Date()
        guard now.timeIntervalSince(lastDebugLogTime) >= debugLogThrottle else { return }
        lastDebugLogTime = now

        // Use userId if available, otherwise skip
        guard let uid = userId else { return }

        var message = event
        if let details = details {
            message += " | \(details)"
        }

        // 1. Insert into debug_log table (persistent history, visible in Supabase dashboard)
        let insertUrlString = "\(supabaseUrl)/rest/v1/debug_log"
        guard let insertUrl = URL(string: insertUrlString) else { return }
        var insertRequest = URLRequest(url: insertUrl)
        insertRequest.httpMethod = "POST"
        let authHeader = authToken ?? supabaseAnonKey
        insertRequest.setValue("Bearer \(authHeader)", forHTTPHeaderField: "Authorization")
        insertRequest.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        insertRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        insertRequest.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let insertBody: [String: Any] = [
            "user_id": uid,
            "event": event,
            "details": details ?? "",
            "platform": "ios"
        ]
        insertRequest.httpBody = try? JSONSerialization.data(withJSONObject: insertBody)

        URLSession.shared.dataTask(with: insertRequest).resume()

        // 2. Also update profiles.last_debug_event for quick status checks
        let urlString = "\(supabaseUrl)/rest/v1/profiles?id=eq.\(uid)"
        guard let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(authHeader)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let body: [String: Any] = [
            "last_debug_event": "\(message) @ \(formatter.string(from: now))"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request).resume()
    }

    // MARK: - Immediate Debug Event
    // Writes to profiles.last_debug_event WITHOUT throttle and WITHOUT debug_log.
    // Used to confirm native code is executing even when sendDebugLog might fail.

    private func writeImmediateDebugEvent(_ event: String, userId: String) {
        let urlString = "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)"
        guard let url = URL(string: urlString) else {
            NSLog("[LocationManager] ⚠️ writeImmediateDebugEvent: INVALID URL '\(urlString.prefix(80))' — supabaseUrl is empty or malformed!")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        let authHeader = authToken ?? supabaseAnonKey
        request.setValue("Bearer \(authHeader)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let body: [String: Any] = [
            "last_debug_event": "\(event) @ \(formatter.string(from: Date()))"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { _, response, error in
            if let httpResponse = response as? HTTPURLResponse {
                NSLog("[LocationManager] Immediate debug '\(event)' status: \(httpResponse.statusCode)")
                if httpResponse.statusCode >= 400 {
                    NSLog("[LocationManager] Immediate debug FAILED: \(httpResponse.statusCode)")
                }
            }
            if let error = error {
                NSLog("[LocationManager] Immediate debug error: \(error.localizedDescription)")
            }
        }.resume()
    }
}