import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize Firebase
        FirebaseApp.configure()
        Messaging.messaging().delegate = self

        // If iOS launched the app in the background for location updates,
        // start the native LocationManager immediately — don't wait for JS.
        // This ensures heartbeats and location updates continue even during
        // cold launches where the webview may not fully initialize before
        // iOS suspends the app again.
        if launchOptions?[.location] != nil {
            print("[AppDelegate] App launched for location updates — starting LocationManager immediately")
            restoreLocationManagerFromStorage()
        }

        return true
    }

    private func restoreLocationManagerFromStorage() {
        let key = "sb-vzlbvknauwvrqwpvtaqe-auth-token"

        guard let jsonString = UserDefaults.standard.string(forKey: key) else {
            print("[AppDelegate] No stored auth token found")
            return
        }

        guard let jsonData = jsonString.data(using: .utf8) else {
            print("[AppDelegate] Could not convert token to data")
            return
        }

        guard let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            print("[AppDelegate] Could not parse token JSON")
            return
        }

        guard let accessToken = json["access_token"] as? String, !accessToken.isEmpty else {
            print("[AppDelegate] No access_token in stored session")
            return
        }

        // Extract user ID from JWT payload
        let parts = accessToken.split(separator: ".")
        guard parts.count == 3 else {
            print("[AppDelegate] Invalid JWT format")
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
            print("[AppDelegate] Could not extract userId from JWT")
            return
        }

        // Check if the access token is expired. If so, try to refresh it before
        // starting the LocationManager, since heartbeats with an expired token
        // will fail with 401 and the JS bridge is suspended in background.
        let nowSeconds = Date().timeIntervalSince1970
        let exp = payload["exp"] as? TimeInterval ?? 0
        var tokenToUse = accessToken

        if nowSeconds >= exp {
            print("[AppDelegate] Stored access token expired (exp=\(exp), now=\(nowSeconds)), attempting refresh")
            // Try to refresh the token natively using the refresh_token from storage
            if let refreshToken = json["refresh_token"] as? String {
                let semaphore = DispatchSemaphore(value: 0)
                let refreshUrl = "\(Bundle.main.object(forInfoDictionaryKey: "SupabaseUrl") as? String ?? "")/auth/v1/token?grant_type=refresh_token"
                guard let url = URL(string: refreshUrl) else {
                    print("[AppDelegate] Invalid refresh URL")
                    return
                }
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue(Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String ?? "", forHTTPHeaderField: "apikey")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

                URLSession.shared.dataTask(with: request) { data, response, error in
                    defer { semaphore.signal() }
                    guard let data = data, error == nil,
                          let httpResponse = response as? HTTPURLResponse,
                          httpResponse.statusCode == 200 else {
                        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                        print("[AppDelegate] Token refresh failed: \(statusCode)")
                        return
                    }
                    if let newSession = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let newToken = newSession["access_token"] as? String {
                        tokenToUse = newToken
                        print("[AppDelegate] Token refreshed successfully on cold start")
                        // Update UserDefaults with new session
                        if let jsonString = UserDefaults.standard.string(forKey: "sb-vzlbvknauwvrqwpvtaqe-auth-token"),
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
                                UserDefaults.standard.set(updatedString, forKey: "sb-vzlbvknauwvrqwpvtaqe-auth-token")
                            }
                        }
                    }
                }.resume()
                semaphore.wait(timeout: .now() + 15)
            } else {
                print("[AppDelegate] No refresh_token available, using expired token (will retry on heartbeat)")
            }
        }

        // Use the shared LocationManager so it persists if JS also starts it later
        if LocationServicePlugin.sharedLocationManager == nil {
            LocationServicePlugin.sharedLocationManager = LocationManager()
        }
        LocationServicePlugin.sharedLocationManager?.startLocationUpdates(userId: userId, authToken: tokenToUse)
        LocationServicePlugin.sharedLocationManager?.setBackgroundAccuracy()
        print("[AppDelegate] LocationManager started with userId=\(userId), tokenExpired=\(nowSeconds >= exp)")
    }

    // MARK: - Silent Push Notifications & Background Fetch
    // These methods wake the app to send heartbeats even when the user is stationary.

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        print("[AppDelegate] Received remote notification (silent push)")

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

        // Send heartbeat immediately — this keeps the user "online"
        LocationServicePlugin.sharedLocationManager?.sendHeartbeatNow()

        // Give network calls time to complete before telling iOS we're done.
        // The heartbeat takes ~1-3s typically, but we allow up to 10s for safety.
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 10) { [weak self] in
            self?.endSilentPushBackgroundTask(bgTaskId, completionHandler: completionHandler)
        }
    }

    func application(_ application: UIApplication, performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        print("[AppDelegate] Background fetch triggered")

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
        print("APNS token passed to Firebase Messaging")

        // Request the FCM token and forward it to Capacitor's PushNotifications plugin
        Messaging.messaging().token(completion: { token, error in
            if let error = error {
                print("Error getting FCM token: \(error)")
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                print("=== FCM TOKEN (via didRegisterForRemoteNotifications) ===")
                print("FCM Token: \(token)")
                // Post the FCM token (String) to Capacitor so the JS side receives the correct token
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            }
        })
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Failed to register for remote notifications: \(error)")
        // Forward the error to Capacitor's PushNotifications plugin
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // Firebase Messaging delegate - receives FCM token updates (including refresh)
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        if let token = fcmToken {
            print("=== FCM TOKEN RECEIVED (via MessagingDelegate) ===")
            print("FCM Token: \(token)")
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