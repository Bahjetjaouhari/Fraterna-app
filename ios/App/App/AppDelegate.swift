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
        // the LocationManager must be started BEFORE the webview loads.
        if launchOptions?[.location] != nil {
            print("[AppDelegate] App launched for location updates — will restore LocationManager when JS initializes")
        }

        return true
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