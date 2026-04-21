import Foundation
import CoreLocation
import UserNotifications

@objc(LocationManager)
class LocationManager: NSObject, CLLocationManagerDelegate {
    private let locationManager = CLLocationManager()
    private let supabaseUrl: String
    private let supabaseAnonKey: String
    private var userId: String?
    private var authToken: String?
    private var proximityCooldowns: [String: Date] = [:]
    private var trackingEnabled: Bool = true
    private var proximityRadiusKm: Double = 1.0
    private var proximityAlertsEnabled: Bool = true

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
    }

    func startLocationUpdates(userId: String, authToken: String) {
        self.userId = userId
        self.authToken = authToken

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.pausesLocationUpdatesAutomatically = true
        locationManager.activityType = .automotive
        locationManager.distanceFilter = 10.0

        locationManager.requestAlwaysAuthorization()
        locationManager.startUpdatingLocation()

        // Register for significant location changes as fallback
        locationManager.startMonitoringSignificantLocationChanges()
    }

    func stopLocationUpdates() {
        locationManager.stopUpdatingLocation()
        locationManager.stopMonitoringSignificantLocationChanges()
        userId = nil
        authToken = nil
    }

    func setTrackingEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
        if enabled {
            locationManager.startUpdatingLocation()
            locationManager.startMonitoringSignificantLocationChanges()
        } else {
            locationManager.stopUpdatingLocation()
            locationManager.stopMonitoringSignificantLocationChanges()
            clearHeartbeat()
        }
    }

    func setForegroundAccuracy() {
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 10.0
    }

    func setBackgroundAccuracy() {
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = 50.0
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last,
              let userId = userId,
              trackingEnabled else { return }

        // Re-read token from UserDefaults to pick up refreshed tokens
        refreshToken()

        guard let currentToken = authToken else { return }

        sendHeartbeat(userId: userId, authToken: currentToken)
        updateLocation(userId: userId, authToken: currentToken, location: location)
        checkProximityAlerts(userId: userId, authToken: currentToken, location: location)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[LocationManager] Location error: \(error.localizedDescription)")
    }

    // MARK: - Token Refresh

    private func refreshToken() {
        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
        guard let jsonString = UserDefaults.standard.string(forKey: key) else { return }
        guard let jsonData = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let newToken = json["access_token"] as? String else { return }

        if newToken != authToken {
            authToken = newToken
            print("[LocationManager] Token refreshed")
        }
    }

    // MARK: - Heartbeat

    private func sendHeartbeat(userId: String, authToken: String) {
        let url = URL(string: "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let body: [String: Any] = ["last_heartbeat_at": formatter.string(from: Date())]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request).resume()
    }

    private func clearHeartbeat() {
        guard let userId = userId, let authToken = authToken else { return }
        let url = URL(string: "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let body: [String: Any] = ["last_heartbeat_at": NSNull()]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request).resume()
    }

    // MARK: - Location Update

    private func updateLocation(userId: String, authToken: String, location: CLLocation) {
        let url = URL(string: "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let body: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request).resume()
    }

    // MARK: - Proximity Alerts

    private func checkProximityAlerts(userId: String, authToken: String, location: CLLocation) {
        guard proximityAlertsEnabled else { return }

        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let radius = proximityRadiusKm * 0.01 // approximate degrees

        let urlString = "\(supabaseUrl)/rest/v1/profiles?select=id,last_heartbeat_at,tracking_enabled,stealth_mode,proximity_alerts_enabled,proximity_radius_km,latitude,longitude&latitude=not.is.null&longitude=not.is.null&id=neq.\(userId)&latitude=gt.\(lat - radius)&latitude=lt.\(lat + radius)&longitude=gt.\(lng - radius)&longitude=lt.\(lng + radius)"

        guard let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self, let data = data, error == nil else { return }

            do {
                guard let profiles = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
                for profile in profiles {
                    self.processProximityAlert(userId: userId, profile: profile, myLocation: location)
                }
            } catch {
                print("[LocationManager] Proximity parse error: \(error)")
            }
        }.resume()
    }

    private func processProximityAlert(userId: String, profile: [String: Any], myLocation: CLLocation) {
        guard let profileId = profile["id"] as? String else { return }

        let trackingEnabled = profile["tracking_enabled"] as? Bool ?? true
        if !trackingEnabled { return }

        let stealthMode = profile["stealth_mode"] as? Bool ?? false
        if stealthMode { return }

        guard let lastHeartbeat = profile["last_heartbeat_at"] as? String else { return }

        // Check heartbeat is within 3 minutes
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let heartbeatDate = formatter.date(from: lastHeartbeat) else { return }
        let threeMinAgo = Date().addingTimeInterval(-180)
        guard heartbeatDate > threeMinAgo else { return }

        // Check distance
        guard let lat = profile["latitude"] as? Double,
              let lng = profile["longitude"] as? Double else { return }
        let theirLocation = CLLocation(latitude: lat, longitude: lng)
        let distance = myLocation.distance(from: theirLocation) / 1000.0 // km

        let theirRadius = profile["proximity_radius_km"] as? Double ?? 1.0
        let myRadius = proximityRadiusKm
        let alertRadius = min(myRadius, theirRadius)

        guard distance <= alertRadius else { return }

        // Check cooldown (2 minutes per user)
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