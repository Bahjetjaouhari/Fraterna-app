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

        // Use the shared LocationManager so it persists if JS also starts it later
        if LocationServicePlugin.sharedLocationManager == nil {
            LocationServicePlugin.sharedLocationManager = LocationManager()
        }
        LocationServicePlugin.sharedLocationManager?.startLocationUpdates(userId: userId, authToken: accessToken)
        LocationServicePlugin.sharedLocationManager?.setBackgroundAccuracy()
        print("[AppDelegate] LocationManager started with userId=\(userId)")
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