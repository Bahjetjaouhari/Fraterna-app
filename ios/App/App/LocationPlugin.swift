import Foundation
import Capacitor
import CoreLocation

@objc(LocationServicePlugin)
public class LocationServicePlugin: CAPPlugin {
    // Use a static reference so the LocationManager survives plugin recreation
    // and remains active even when the webview/JS context is suspended.
    private static var sharedLocationManager: LocationManager?

    @objc func startLocationUpdates(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"),
              let authToken = call.getString("authToken") else {
            call.reject("Missing userId or authToken")
            return
        }

        if LocationServicePlugin.sharedLocationManager == nil {
            LocationServicePlugin.sharedLocationManager = LocationManager()
        }

        LocationServicePlugin.sharedLocationManager?.startLocationUpdates(userId: userId, authToken: authToken)
        call.resolve()
    }

    @objc func stopLocationUpdates(_ call: CAPPluginCall) {
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

    @objc func setForegroundAccuracy(_ call: CAPPluginCall) {
        LocationServicePlugin.sharedLocationManager?.setForegroundAccuracy()
        call.resolve()
    }

    @objc func setBackgroundAccuracy(_ call: CAPPluginCall) {
        LocationServicePlugin.sharedLocationManager?.setBackgroundAccuracy()
        call.resolve()
    }
}