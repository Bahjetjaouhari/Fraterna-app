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

    override init() {
        guard let url = Bundle.main.object(forInfoDictionaryKey: "SupabaseUrl") as? String,
              let key = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String else {
            supabaseUrl = ""
            supabaseAnonKey = ""
            super.init()
            return
        }
        supabaseUrl = url
        supabaseAnonKey = key
        super.init()

        locationManager.delegate = self
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.activityType = .otherNavigation

        // Listen for foreground/background transitions natively so we don't
        // depend on the Capacitor JS bridge (which is suspended in background).
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillTerminate), name: UIApplication.willTerminateNotification, object: nil)
    }

    func startLocationUpdates(userId: String, authToken: String) {
        self.userId = userId
        self.authToken = authToken

        // Set up notification delegate for foreground notifications
        UNUserNotificationCenter.current().delegate = self

        // Request notification permission for proximity alerts
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("[LocationManager] Notification permission error: \(error)")
            }
            print("[LocationManager] Notification permission granted: \(granted)")
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

        // Start heartbeat timer immediately.
        // Note: this timer SUSPENDS when the app is suspended. It only fires
        // when the app is in the foreground or briefly awakened by location updates.
        // The PRIMARY heartbeat mechanism is didUpdateLocations.
        startHeartbeatTimer()

        // Send an immediate heartbeat to confirm we're online
        sendHeartbeatNow()

        // Load profile settings
        loadProfileSettings()

        print("[LocationManager] Location updates started for userId=\(userId), authStatus=\(status.rawValue)")
    }

    func stopLocationUpdates() {
        locationManager.stopUpdatingLocation()
        locationManager.stopMonitoringSignificantLocationChanges()
        stopHeartbeatTimer()
        userId = nil
        authToken = nil
    }

    /// Update auth token from JS bridge (called on every onAuthStateChange and app foreground resume)
    func updateAuthToken(authToken: String, userId: String? = nil) {
        self.authToken = authToken
        if let userId = userId {
            self.userId = userId
        }
        print("[LocationManager] Auth token updated from JS bridge")
    }

    func setTrackingEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
        if enabled {
            locationManager.startUpdatingLocation()
            locationManager.startMonitoringSignificantLocationChanges()
            startHeartbeatTimer()
            sendHeartbeatNow()
        } else {
            locationManager.stopUpdatingLocation()
            locationManager.stopMonitoringSignificantLocationChanges()
            stopHeartbeatTimer()
            // Don't set last_heartbeat_at to null — let it expire naturally on server
            print("[LocationManager] Tracking disabled — heartbeat will expire naturally")
        }
    }

    // MARK: - Authorization

    func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        print("[LocationManager] Authorization changed to: \(status.rawValue)")

        if status == .authorizedAlways {
            // Great — full background tracking is available
            if userId != nil {
                locationManager.startUpdatingLocation()
                locationManager.startMonitoringSignificantLocationChanges()
            }
        } else if status == .authorizedWhenInUse {
            // User only granted "When In Use" — background tracking will stop when app is suspended
            // We need "Always" for reliable background tracking
            print("[LocationManager] WARNING: Only 'When In Use' authorization. Background tracking will be limited.")
            print("[LocationManager] User must go to Settings > Fraterna > Location > Always to enable full background tracking")
            // Still start updates — they'll work while app is in foreground
            if userId != nil {
                locationManager.startUpdatingLocation()
                locationManager.startMonitoringSignificantLocationChanges()
            }
        } else if status == .denied || status == .restricted {
            print("[LocationManager] Location authorization denied or restricted")
        }
    }

    // JS bridge calls these, but the native NotificationCenter observers
    // are the authoritative source for accuracy transitions.
    func setForegroundAccuracy() {
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
    }

    func setBackgroundAccuracy() {
        // Use NearestTenMeters in background to prevent iOS from throttling updates.
        // kCLLocationAccuracyBest in background causes iOS to aggressively throttle
        // or suspend location updates to preserve battery.
        locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        locationManager.distanceFilter = kCLDistanceFilterNone
        // Ensure heartbeat is running in background
        if heartbeatTimer == nil {
            startHeartbeatTimer()
        }
    }

    // MARK: - Native foreground/background observers
    // These fire regardless of whether the Capacitor webview is alive.

    @objc private func appDidEnterBackground() {
        isInBackground = true
        print("[LocationManager] App entered background (native)")
        // Switch to battery-efficient accuracy for background.
        // This prevents iOS from throttling or killing our location updates.
        locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        locationManager.distanceFilter = kCLDistanceFilterNone
        // Ensure heartbeat timer is running
        if heartbeatTimer == nil {
            startHeartbeatTimer()
        }
    }

    @objc private func appDidBecomeActive() {
        isInBackground = false
        print("[LocationManager] App became active (native)")
        // Switch to high accuracy in foreground for precise tracking
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        // Send immediate heartbeat on resume to update status quickly
        sendHeartbeatNow()
    }

    @objc private func appWillTerminate() {
        print("[LocationManager] App will terminate — saving state")
        // Don't stop location updates on termination.
        // startMonitoringSignificantLocationChanges will relaunch the app.
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last,
              let userId = userId,
              trackingEnabled else { return }

        // This is the PRIMARY heartbeat mechanism.
        // Every location update triggers a heartbeat + location upload.
        // The DispatchSourceTimer is a backup that only works in foreground.

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
        print("[LocationManager] Location error: \(error.localizedDescription)")
    }

    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        // This should NOT be called because pausesLocationUpdatesAutomatically = false.
        // But if it is, restart updates immediately and start the heartbeat timer
        // to keep the user online.
        print("[LocationManager] ⚠️ Location updates PAUSED — restarting immediately")
        manager.startUpdatingLocation()
        manager.startMonitoringSignificantLocationChanges()
        startHeartbeatTimer()
    }

    func locationManagerDidResumeLocationUpdates(_ manager: CLLocationManager) {
        print("[LocationManager] Location updates resumed")
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
        print("[LocationManager] Heartbeat timer started (every \(heartbeatInterval)s)")
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
        }
    }

    // MARK: - Token Refresh
    // Only checks UserDefaults for newer tokens written by the JS client.
    // Does NOT attempt Supabase token refresh — the refresh_token in UserDefaults
    // is always stale because the JS client already used it for its own refresh.
    // Fresh tokens come from the JS bridge via updateAuthToken() / onAuthStateChange.

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
            print("[LocationManager] Token updated from storage (JS client refreshed)")
        }
        // No Supabase refresh attempt — the refresh_token is always stale
        completion()
    }

    // MARK: - Profile Settings

    private func loadProfileSettings() {
        guard let userId = userId else { return }
        refreshTokenAsync { [weak self] in
            guard let self = self, let token = self.authToken else { return }

            let urlString = "\(self.supabaseUrl)/rest/v1/profiles?id=eq.\(userId)&select=proximity_radius_km,proximity_alerts_enabled,stealth_mode,tracking_enabled"
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
                        print("[LocationManager] Stealth mode: \(stealth) — heartbeats continue regardless")
                    }
                    if let radius = profile["proximity_radius_km"] as? Double {
                        self.proximityRadiusKm = radius
                    }
                    if let alerts = profile["proximity_alerts_enabled"] as? Bool {
                        self.proximityAlertsEnabled = alerts
                    }
                } catch {
                    print("[LocationManager] Error loading profile settings: \(error)")
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
            print("[LocationManager] Heartbeat throttled (sent \(Int(now.timeIntervalSince(lastHeartbeatTime)))s ago)")
            completion?()
            return
        }
        lastHeartbeatTime = now

        let url = URL(string: "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
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
                    print("[LocationManager] ✓ Heartbeat sent")
                } else {
                    print("[LocationManager] ✗ Heartbeat failed: \(httpResponse.statusCode)")
                    if httpResponse.statusCode == 401 {
                        print("[LocationManager] Got 401, checking UserDefaults for newer token...")
                        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
                        if let jsonString = UserDefaults.standard.string(forKey: key),
                           let jsonData = jsonString.data(using: .utf8),
                           let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                           let storedAccessToken = json["access_token"] as? String,
                           storedAccessToken != self?.authToken {
                            self?.authToken = storedAccessToken
                            print("[LocationManager] Token updated from storage after 401")
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
            print("[LocationManager] Skipping location upload: stealth=\(stealthMode), tracking=\(trackingEnabled)")
            completion?()
            return
        }

        let url = URL(string: "\(supabaseUrl)/rest/v1/locations?on_conflict=user_id")!
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
                    print("[LocationManager] ✓ Location updated")
                } else {
                    print("[LocationManager] ✗ Location update failed: \(httpResponse.statusCode)")
                }
            }
            completion?()
        }.resume()
    }

    // MARK: - Proximity Alerts

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
            completion?()
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self, let data = data, error == nil else {
                completion?()
                return
            }

            // Also refresh profile settings periodically
            self.loadProfileSettings()

            do {
                guard let locationEntries = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                    completion?()
                    return
                }
                for entry in locationEntries {
                    self.processProximityAlert(myLocation: location, entry: entry)
                }
            } catch {
                print("[LocationManager] Proximity parse error: \(error)")
            }
            completion?()
        }.resume()
    }

    private func processProximityAlert(myLocation: CLLocation, entry: [String: Any]) {
        guard let theirLat = entry["lat"] as? Double,
              let theirLng = entry["lng"] as? Double else { return }

        guard let profile = entry["profile"] as? [String: Any],
              let profileId = profile["id"] as? String else { return }

        let theirTracking = profile["tracking_enabled"] as? Bool ?? false
        if !theirTracking { return }

        let theirStealth = profile["stealth_mode"] as? Bool ?? false
        if theirStealth { return }

        guard let lastHeartbeat = profile["last_heartbeat_at"] as? String else { return }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let heartbeatDate = formatter.date(from: lastHeartbeat) else { return }
        let fiveMinAgo = Date().addingTimeInterval(-300) // Match 5-minute threshold
        guard heartbeatDate > fiveMinAgo else { return }

        let theirLocation = CLLocation(latitude: theirLat, longitude: theirLng)
        let distance = myLocation.distance(from: theirLocation) / 1000.0

        let theirRadius = profile["proximity_radius_km"] as? Double ?? 5.0
        let theirAlerts = profile["proximity_alerts_enabled"] as? Bool ?? true
        let myRadius = proximityRadiusKm
        let alertRadius = min(myRadius, theirRadius)

        guard distance <= alertRadius, theirAlerts else { return }

        if let lastAlert = proximityCooldowns[profileId],
           Date().timeIntervalSince(lastAlert) < 120 { return }

        proximityCooldowns[profileId] = Date()
        sendProximityNotification(profileId: profileId, distance: distance)
    }

    private func sendProximityNotification(profileId: String, distance: Double) {
        let content = UNMutableNotificationContent()
        content.title = "QH Cerca"
        content.body = String(format: "Un QH hermano está a %.1f km de ti", distance)
        content.sound = .default
        content.categoryIdentifier = "proximity"

        let request = UNNotificationRequest(identifier: "proximity-\(profileId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}