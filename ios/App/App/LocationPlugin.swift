import Foundation
import Capacitor
import CoreLocation

@objc(LocationServicePlugin)
public class LocationServicePlugin: CAPPlugin {
    private var locationManager: LocationManager?

    @objc func startLocationUpdates(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"),
              let authToken = call.getString("authToken") else {
            call.reject("Missing userId or authToken")
            return
        }

        if locationManager == nil {
            locationManager = LocationManager()
        }

        locationManager?.startLocationUpdates(userId: userId, authToken: authToken)
        call.resolve()
    }

    @objc func stopLocationUpdates(_ call: CAPPluginCall) {
        locationManager?.stopLocationUpdates()
        call.resolve()
    }

    @objc func isServiceRunning(_ call: CAPPluginCall) {
        let running = locationManager != nil
        call.resolve([
            "running": running
        ])
    }

    @objc func getLastKnownLocation(_ call: CAPPluginCall) {
        // iOS does not persist last known location to SharedPreferences like Android.
        // Return a placeholder indicating location is available via ongoing updates.
        call.reject("Location updates are managed by CLLocationManager. Use startLocationUpdates to receive locations.")
    }

    @objc func setTrackingEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Missing enabled parameter")
            return
        }
        locationManager?.setTrackingEnabled(enabled)
        call.resolve()
    }

    @objc func setForegroundAccuracy(_ call: CAPPluginCall) {
        locationManager?.setForegroundAccuracy()
        call.resolve()
    }

    @objc func setBackgroundAccuracy(_ call: CAPPluginCall) {
        locationManager?.setBackgroundAccuracy()
        call.resolve()
    }
}