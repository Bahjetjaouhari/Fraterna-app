import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging
import BackgroundTasks

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?
    private let heartbeatTaskIdentifier = "com.fraterna.heartbeat"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize Firebase
        FirebaseApp.configure()
        Messaging.messaging().delegate = self

        // Register BGProcessingTask for periodic background heartbeats
        BGTaskScheduler.shared.register(forTaskWithIdentifier: heartbeatTaskIdentifier, using: nil) { task in
            self.handleHeartbeatBackgroundTask(task as! BGProcessingTask)
        }

        // If iOS launched the app in the background for location updates,
        // start the native LocationManager immediately — don't wait for JS.
        // This ensures heartbeats and location updates continue even during
        // cold launches where the webview may not fully initialize before
        // iOS suspends the app again.
        if launchOptions?[.location] != nil {
            NSLog("[AppDelegate] App launched for location updates — starting LocationManager immediately")
            restoreLocationManagerFromStorage()
        }

        // Schedule the first background heartbeat task
        scheduleHeartbeatBackgroundTask()

        return true
    }

    // MARK: - BGProcessingTask for background heartbeats

    private func scheduleHeartbeatBackgroundTask() {
        let request = BGProcessingTaskRequest(identifier: heartbeatTaskIdentifier)
        // Run every 15 minutes (earliest), requires network and external power is NOT required
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false

        do {
            try BGTaskScheduler.shared.submit(request)
            NSLog("[AppDelegate] Scheduled heartbeat BGProcessingTask for +15min")
        } catch {
            NSLog("[AppDelegate] Failed to schedule BGProcessingTask: \(error)")
        }
    }

    private func handleHeartbeatBackgroundTask(_ task: BGProcessingTask) {
        NSLog("[AppDelegate] BGProcessingTask fired — sending heartbeat")

        // Schedule the next task before processing this one
        scheduleHeartbeatBackgroundTask()

        // Restore LocationManager if needed (already dispatches to main thread internally)
        if LocationServicePlugin.sharedLocationManager == nil {
            restoreLocationManagerFromStorage()
        }

        let locationManager = LocationServicePlugin.sharedLocationManager

        // "Pulse" mode: briefly restart GPS, send heartbeat
        // pulseLocationUpdate and sendHeartbeatNow both use onMainThread internally
        locationManager?.pulseLocationUpdate()
        locationManager?.sendHeartbeatNow()

        // Also check proximity in background task
        locationManager?.sendProximityCheckFromPush()

        // Tell iOS we're done — use a delay to let network calls and GPS complete
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 25) {
            task.setTaskCompleted(success: true)
        }

        // If the system tells us to stop early, end gracefully
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }
    }

    private func restoreLocationManagerFromStorage() {
        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"

        guard let jsonString = UserDefaults.standard.string(forKey: key) else {
            NSLog("[AppDelegate] No stored auth token found")
            return
        }

        guard let jsonData = jsonString.data(using: .utf8) else {
            NSLog("[AppDelegate] Could not convert token to data")
            return
        }

        guard let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            NSLog("[AppDelegate] Could not parse token JSON")
            return
        }

        guard let accessToken = json["access_token"] as? String, !accessToken.isEmpty else {
            NSLog("[AppDelegate] No access_token in stored session")
            return
        }

        // Extract user ID from JWT payload
        let parts = accessToken.split(separator: ".")
        guard parts.count == 3 else {
            NSLog("[AppDelegate] Invalid JWT format")
            return
        }

        var base64 = String(parts[1])
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }

        guard let payloadData = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let userId = payload["sub"] as? String else {
            NSLog("[AppDelegate] Could not extract userId from JWT")
            return
        }

        // Check if the access token is expired. If so, refresh it asynchronously
        // on a background queue — NEVER block the main thread with DispatchSemaphore
        // as iOS watchdog kills apps that block the main thread for >10 seconds.
        let nowSeconds = Date().timeIntervalSince1970
        let exp = payload["exp"] as? TimeInterval ?? 0

        if nowSeconds >= exp {
            NSLog("[AppDelegate] Stored access token expired (exp=\(exp), now=\(nowSeconds)), attempting async refresh")
            if let refreshToken = json["refresh_token"] as? String {
                // Token refresh runs entirely on a background queue — no main thread blocking
                restoreLocationManagerWithTokenRefresh(userId: userId, refreshToken: refreshToken, expiredToken: accessToken)
            } else {
                NSLog("[AppDelegate] No refresh_token available, starting with expired token (will retry on heartbeat)")
                startLocationManagerOnMainThread(userId: userId, token: accessToken)
            }
        } else {
            startLocationManagerOnMainThread(userId: userId, token: accessToken)
        }
    }

    /// Refresh the Supabase token on a background queue, then start LocationManager on main thread.
    /// This replaces the previous DispatchSemaphore-based approach that blocked the main thread
    /// for up to 15 seconds, risking iOS watchdog termination.
    private func restoreLocationManagerWithTokenRefresh(userId: String, refreshToken: String, expiredToken: String) {
        let refreshUrl = "\(Bundle.main.object(forInfoDictionaryKey: "SupabaseUrl") as? String ?? "")/auth/v1/token?grant_type=refresh_token"
        guard let url = URL(string: refreshUrl) else {
            NSLog("[AppDelegate] Invalid refresh URL, starting with expired token")
            startLocationManagerOnMainThread(userId: userId, token: expiredToken)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String ?? "", forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

        // URLSession completion runs on a background queue — no main thread blocking
        URLSession.shared.dataTask(with: request) { data, response, error in
            var tokenToUse = expiredToken

            if let data = data, error == nil,
               let httpResponse = response as? HTTPURLResponse,
               httpResponse.statusCode == 200,
               let newSession = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let newToken = newSession["access_token"] as? String {
                tokenToUse = newToken
                NSLog("[AppDelegate] Token refreshed successfully (async)")
                // Update UserDefaults with new session
                let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"
                if let jsonString = UserDefaults.standard.string(forKey: key),
                   let jsonData = jsonString.data(using: .utf8),
                   var storedSession = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
                    storedSession["access_token"] = newToken
                    if let newRefresh = newSession["refresh_token"] as? String {
                        storedSession["refresh_token"] = newRefresh
                    }
                    storedSession["expires_at"] = newSession["expires_at"]
                    storedSession["expires_in"] = newSession["expires_in"]
                    if let updatedData = try? JSONSerialization.data(withJSONObject: storedSession),
                       let updatedString = String(data: updatedData, encoding: .utf8) {
                        UserDefaults.standard.set(updatedString, forKey: key)
                    }
                }
            } else {
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                NSLog("[AppDelegate] Token refresh failed: \(statusCode), starting with expired token")
            }

            self.startLocationManagerOnMainThread(userId: userId, token: tokenToUse)
        }.resume()
    }

    /// Create and start the LocationManager on the main thread.
    /// CLLocationManager requires a run loop and won't deliver delegate callbacks
    /// if created on a background thread.
    private func startLocationManagerOnMainThread(userId: String, token: String) {
        DispatchQueue.main.async {
            if LocationServicePlugin.sharedLocationManager == nil {
                LocationServicePlugin.sharedLocationManager = LocationManager()
            }
            LocationServicePlugin.sharedLocationManager?.startLocationUpdates(userId: userId, authToken: token)
            LocationServicePlugin.sharedLocationManager?.setBackgroundAccuracy()
            NSLog("[AppDelegate] LocationManager started on main thread with userId=\(userId.prefix(8))")
        }
    }

    // MARK: - Silent Push Notifications & Background Fetch
    // These methods wake the app to send heartbeats even when the user is stationary.

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NSLog("[AppDelegate] Received remote notification (silent push)")

        // Protect the heartbeat with a UIBackgroundTask so iOS doesn't suspend
        // the app before the network request completes.
        var bgTaskId: UIBackgroundTaskIdentifier = .invalid
        bgTaskId = application.beginBackgroundTask(withName: "SilentPushHeartbeat") {
            // Expiration handler — iOS is about to suspend us
            self.endSilentPushBackgroundTask(bgTaskId, completionHandler: completionHandler)
        }

        // If the LocationManager is not running, restore it from storage
        if LocationServicePlugin.sharedLocationManager == nil {
            restoreLocationManagerFromStorage()
        }

        // "Pulse" mode: briefly restart GPS at low accuracy when woken by push.
        // This forces iOS to deliver at least one location callback → heartbeat.
        // The arrow appears briefly, then iOS pauses GPS again when stationary.
        LocationServicePlugin.sharedLocationManager?.pulseLocationUpdate()

        // Send heartbeat immediately — this keeps the user "online"
        LocationServicePlugin.sharedLocationManager?.sendHeartbeatNow()

        // Check proximity when woken by push
        LocationServicePlugin.sharedLocationManager?.sendProximityCheckFromPush()

        // Schedule completion after 10s to let network calls finish
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 10) { [weak self] in
            self?.endSilentPushBackgroundTask(bgTaskId, completionHandler: completionHandler)
        }

        // Follow-up heartbeat 15s after push (before background task expires)
        var followUpTaskId: UIBackgroundTaskIdentifier = .invalid
        followUpTaskId = application.beginBackgroundTask(withName: "SilentPushFollowUp") {
            UIApplication.shared.endBackgroundTask(followUpTaskId)
        }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 15) { [weak self] in
            self?.sendFollowUpHeartbeat()
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5) {
                UIApplication.shared.endBackgroundTask(followUpTaskId)
            }
        }
    }

    private func sendFollowUpHeartbeat() {
        LocationServicePlugin.sharedLocationManager?.sendHeartbeatNow()
    }

    func application(_ application: UIApplication, performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NSLog("[AppDelegate] Background fetch triggered")

        var bgTaskId: UIBackgroundTaskIdentifier = .invalid
        bgTaskId = application.beginBackgroundTask(withName: "BackgroundFetchHeartbeat") {
            self.endSilentPushBackgroundTask(bgTaskId, completionHandler: completionHandler)
        }

        if LocationServicePlugin.sharedLocationManager == nil {
            restoreLocationManagerFromStorage()
        }

        LocationServicePlugin.sharedLocationManager?.sendHeartbeatNow()

        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 10) { [weak self] in
            self?.endSilentPushBackgroundTask(bgTaskId, completionHandler: completionHandler)
        }
    }

    private func endSilentPushBackgroundTask(_ taskId: UIBackgroundTaskIdentifier, completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        completionHandler(.newData)
        if taskId != .invalid {
            UIApplication.shared.endBackgroundTask(taskId)
        }
    }

    // Pass APNS token to Firebase, then forward the FCM token to Capacitor
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        NSLog("APNS token passed to Firebase Messaging")

        // Request the FCM token and forward it to Capacitor's PushNotifications plugin
        Messaging.messaging().token(completion: { token, error in
            if let error = error {
                NSLog("Error getting FCM token: \(error)")
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                NSLog("=== FCM TOKEN (via didRegisterForRemoteNotifications) ===")
                NSLog("FCM Token: \(token)")
                // Post the FCM token (String) to Capacitor so the JS side receives the correct token
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            }
        })
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("Failed to register for remote notifications: \(error)")
        // Forward the error to Capacitor's PushNotifications plugin
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // Firebase Messaging delegate - receives FCM token updates (including refresh)
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        if let token = fcmToken {
            NSLog("=== FCM TOKEN RECEIVED (via MessagingDelegate) ===")
            NSLog("FCM Token: \(token)")
            // Also post to Capacitor so the JS side gets token refresh updates
            NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
        }
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}