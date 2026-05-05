import Foundation
import Capacitor
import CoreLocation

@objc(LocationServicePlugin)
public class LocationServicePlugin: CAPPlugin {
    // Use a static reference so the LocationManager survives plugin recreation
    // and remains active even when the webview/JS context is suspended.
    // Accessible from AppDelegate for cold-start restoration.
    static var sharedLocationManager: LocationManager?

    @objc func startLocationUpdates(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"),
              let authToken = call.getString("authToken") else {
            NSLog("[LocationPlugin] ⚠️ startLocationUpdates called WITHOUT userId or authToken")
            call.reject("Missing userId or authToken")
            return
        }

        NSLog("[LocationPlugin] startLocationUpdates called — userId=\(userId.prefix(8))..., tokenLen=\(authToken.count)")

        if LocationServicePlugin.sharedLocationManager == nil {
            NSLog("[LocationPlugin] Creating new LocationManager instance")
            LocationServicePlugin.sharedLocationManager = LocationManager()
        }

        LocationServicePlugin.sharedLocationManager?.startLocationUpdates(userId: userId, authToken: authToken)
        call.resolve()
    }

    @objc func stopLocationUpdates(_ call: CAPPluginCall) {
        NSLog("[LocationPlugin] stopLocationUpdates called")
        LocationServicePlugin.sharedLocationManager?.stopLocationUpdates()
        LocationServicePlugin.sharedLocationManager = nil
        call.resolve()
    }

    @objc func isServiceRunning(_ call: CAPPluginCall) {
        let running = LocationServicePlugin.sharedLocationManager != nil
        call.resolve([
            "running": running
        ])
    }

    @objc func getLastKnownLocation(_ call: CAPPluginCall) {
        call.reject("Location updates are managed by CLLocationManager. Use startLocationUpdates to receive locations.")
    }

    @objc func setTrackingEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Missing enabled parameter")
            return
        }
        LocationServicePlugin.sharedLocationManager?.setTrackingEnabled(enabled)
        call.resolve()
    }

    @objc func setStealthMode(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Missing enabled parameter")
            return
        }
        LocationServicePlugin.sharedLocationManager?.setStealthMode(enabled)
        call.resolve()
    }

    @objc func setForegroundAccuracy(_ call: CAPPluginCall) {
        LocationServicePlugin.sharedLocationManager?.setForegroundAccuracy()
        call.resolve()
    }

    @objc func setBackgroundAccuracy(_ call: CAPPluginCall) {
        LocationServicePlugin.sharedLocationManager?.setBackgroundAccuracy()
        call.resolve()
    }

    @objc func updateAuthToken(_ call: CAPPluginCall) {
        guard let authToken = call.getString("authToken") else {
            call.reject("Missing authToken")
            return
        }
        let userId = call.getString("userId")
        NSLog("[LocationPlugin] updateAuthToken called — tokenLen=\(authToken.count)")
        LocationServicePlugin.sharedLocationManager?.updateAuthToken(authToken: authToken, userId: userId)
        call.resolve()
    }
}