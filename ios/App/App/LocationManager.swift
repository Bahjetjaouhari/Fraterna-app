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
    private var proximityRadiusKm: Double = 5.0
    private var proximityAlertsEnabled: Bool = true
    private var heartbeatTimer: DispatchSourceTimer?
    private let heartbeatInterval: TimeInterval = 90 // 1.5 minutes — tight enough for the 3-min online threshold

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

        // Listen for foreground/background transitions natively so we don't
        // depend on the Capacitor JS bridge (which is suspended in background).
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
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

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.activityType = .otherNavigation
        locationManager.distanceFilter = 10.0

        locationManager.requestAlwaysAuthorization()
        locationManager.startUpdatingLocation()
        locationManager.startMonitoringSignificantLocationChanges()

        // Start heartbeat timer immediately — don't wait for JS to call setBackgroundAccuracy.
        // The timer is cheap (one PATCH every 90s) and ensures the user stays "online"
        // even if the JS bridge never fires the background transition.
        startHeartbeatTimer()

        // Load profile settings
        loadProfileSettings()

        print("[LocationManager] Location updates started for userId=\(userId)")
    }

    func stopLocationUpdates() {
        locationManager.stopUpdatingLocation()
        locationManager.stopMonitoringSignificantLocationChanges()
        stopHeartbeatTimer()
        userId = nil
        authToken = nil
    }

    func setTrackingEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
        if enabled {
            locationManager.startUpdatingLocation()
            locationManager.startMonitoringSignificantLocationChanges()
            startHeartbeatTimer()
        } else {
            locationManager.stopUpdatingLocation()
            locationManager.stopMonitoringSignificantLocationChanges()
            stopHeartbeatTimer()
            clearHeartbeat()
        }
    }

    // JS bridge calls these, but the native NotificationCenter observers
    // are the authoritative source. The JS calls are kept as a fallback.
    func setForegroundAccuracy() {
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 10.0
        // Keep heartbeat running even in foreground — it's cheap and ensures
        // the user never appears offline if location updates slow down.
    }

    func setBackgroundAccuracy() {
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        // Heartbeat is already running from startLocationUpdates — just ensure it stays on.
        if heartbeatTimer == nil {
            startHeartbeatTimer()
        }
    }

    // MARK: - Native foreground/background observers
    // These fire regardless of whether the Capacitor webview is alive.

    @objc private func appDidEnterBackground() {
        print("[LocationManager] App entered background (native)")
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        if heartbeatTimer == nil {
            startHeartbeatTimer()
        }
    }

    @objc private func appDidBecomeActive() {
        print("[LocationManager] App became active (native)")
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 10.0
        // Don't stop heartbeat timer — it's cheap insurance.
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

        // Refresh token asynchronously, then send heartbeat + location update
        refreshTokenAsync { [weak self] in
            guard let self = self else { return }
            guard let currentToken = self.authToken else { return }

            self.sendHeartbeat(userId: userId, authToken: currentToken)
            self.updateLocation(userId: userId, authToken: currentToken, location: location)
            self.checkProximityAlerts(userId: userId, authToken: currentToken, location: location)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[LocationManager] Location error: \(error.localizedDescription)")
    }

    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        print("[LocationManager] Location updates paused (user stationary)")
        startHeartbeatTimer()
    }

    func locationManagerDidResumeLocationUpdates(_ manager: CLLocationManager) {
        print("[LocationManager] Location updates resumed")
    }

    // MARK: - Heartbeat Timer
    // Runs continuously once started. Fires when iOS wakes the app for
    // location updates or other background events. Does NOT fire while
    // the app is fully suspended, but didUpdateLocations handles that case.

    private func startHeartbeatTimer() {
        // Don't restart if already running
        if heartbeatTimer != nil { return }

        guard userId != nil else { return }

        // Send an immediate heartbeat
        refreshTokenAsync { [weak self] in
            guard let self = self else { return }
            if let userId = self.userId, let token = self.authToken {
                self.sendHeartbeat(userId: userId, authToken: token)
            }
        }

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

    // MARK: - Token Refresh (ASYNC — no semaphore)

    private func refreshTokenAsync(completion: @escaping () -> Void) {
        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
        guard let jsonString = UserDefaults.standard.string(forKey: key),
              let jsonData = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            completion()
            return
        }

        // First: check if JS client already refreshed the token in storage
        if let storedAccessToken = json["access_token"] as? String,
           storedAccessToken != authToken {
            authToken = storedAccessToken
            print("[LocationManager] Token updated from storage (JS client refreshed)")
        }

        // Check if current token is expired or about to expire (within 5 minutes)
        guard let currentToken = authToken else {
            completion()
            return
        }
        if isTokenExpiringSoon(currentToken, thresholdSeconds: 300) {
            print("[LocationManager] Token expiring soon, refreshing via Supabase...")
            if let refreshTokenStr = json["refresh_token"] as? String {
                performTokenRefreshAsync(refreshToken: refreshTokenStr, completion: completion)
            } else {
                print("[LocationManager] No refresh_token found in stored session")
                completion()
            }
        } else {
            completion()
        }
    }

    private func isTokenExpiringSoon(_ token: String, thresholdSeconds: TimeInterval) -> Bool {
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
        return (exp - nowSeconds) < thresholdSeconds
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
                print("[LocationManager] Token refresh failed: \(statusCode) - \(error?.localizedDescription ?? "unknown")")
                if statusCode == 400 || statusCode == 401 {
                    print("[LocationManager] Refresh token is invalid. User needs to re-login.")
                }
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
                print("[LocationManager] Token refreshed successfully via Supabase")

                if let userObj = newSession["user"] as? [String: Any],
                   let newUserId = userObj["id"] as? String {
                    self.userId = newUserId
                }

                // Update UserDefaults so JS client also picks up the new tokens
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
                        print("[LocationManager] Updated token in UserDefaults")
                    }
                }
            } catch {
                print("[LocationManager] Error parsing refresh response: \(error)")
            }
            completion()
        }.resume()
    }

    // MARK: - Profile Settings

    private func loadProfileSettings() {
        guard let userId = userId else { return }
        refreshTokenAsync { [weak self] in
            guard let self = self, let token = self.authToken else { return }

            let urlString = "\(self.supabaseUrl)/rest/v1/profiles?id=eq.\(userId)&select=proximity_radius_km,proximity_alerts_enabled"
            guard let url = URL(string: urlString) else { return }
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue(self.supabaseAnonKey, forHTTPHeaderField: "apikey")

            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                guard let self = self, let data = data, error == nil else { return }
                do {
                    guard let profiles = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
                          let profile = profiles.first else { return }
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

    private func sendHeartbeat(userId: String, authToken: String) {
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
                    print("[LocationManager] Heartbeat sent successfully")
                } else {
                    print("[LocationManager] Heartbeat failed: \(httpResponse.statusCode)")
                    if httpResponse.statusCode == 401 {
                        print("[LocationManager] Got 401, forcing token refresh...")
                        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
                        if let jsonString = UserDefaults.standard.string(forKey: key),
                           let jsonData = jsonString.data(using: .utf8),
                           let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                           let rt = json["refresh_token"] as? String {
                            self?.performTokenRefreshAsync(refreshToken: rt) {
                                // Token refreshed, next heartbeat will use the new token
                            }
                        }
                    }
                }
            }
        }.resume()
    }

    private func clearHeartbeat() {
        refreshTokenAsync { [weak self] in
            guard let self = self, let userId = self.userId, let token = self.authToken else { return }
            let url = URL(string: "\(self.supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
            var request = URLRequest(url: url)
            request.httpMethod = "PATCH"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue(self.supabaseAnonKey, forHTTPHeaderField: "apikey")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

            let body: [String: Any] = ["last_heartbeat_at": NSNull()]
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)

            URLSession.shared.dataTask(with: request) { _, response, error in
                if let httpResponse = response as? HTTPURLResponse {
                    if httpResponse.statusCode == 200 || httpResponse.statusCode == 204 {
                        print("[LocationManager] Heartbeat cleared successfully")
                    } else {
                        print("[LocationManager] Clear heartbeat failed: \(httpResponse.statusCode)")
                    }
                }
            }.resume()
        }
    }

    // MARK: - Location Update

    private func updateLocation(userId: String, authToken: String, location: CLLocation) {
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
                    print("[LocationManager] Location updated in Supabase")
                } else {
                    print("[LocationManager] Location update failed: \(httpResponse.statusCode)")
                }
            }
        }.resume()
    }

    // MARK: - Proximity Alerts

    private func checkProximityAlerts(userId: String, authToken: String, location: CLLocation) {
        guard proximityAlertsEnabled else { return }

        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let radius = proximityRadiusKm * 0.01

        let urlString = "\(supabaseUrl)/rest/v1/locations?select=user_id,lat,lng,profile:profiles!locations_user_id_fkey(id,full_name,tracking_enabled,stealth_mode,last_heartbeat_at,proximity_alerts_enabled,proximity_radius_km)&lat=not.is.null&lng=not.is.null&user_id=neq.\(userId)&lat=gt.\(lat - radius)&lat=lt.\(lat + radius)&lng=gt.\(lng - radius)&lng=lt.\(lng + radius)"

        guard let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self, let data = data, error == nil else { return }

            self.loadProfileSettings()

            do {
                guard let locationEntries = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
                for entry in locationEntries {
                    self.processProximityAlert(myLocation: location, entry: entry)
                }
            } catch {
                print("[LocationManager] Proximity parse error: \(error)")
            }
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
        let threeMinAgo = Date().addingTimeInterval(-180)
        guard heartbeatDate > threeMinAgo else { return }

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