#import <Capacitor/Capacitor.h>

CAP_PLUGIN_RESOLVE_REGISTER_FILE

CAP_PLUGIN(LocationServicePlugin, "LocationService",
    CAP_PLUGIN_METHOD(startLocationUpdates, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopLocationUpdates, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(isServiceRunning, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getLastKnownLocation, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setTrackingEnabled, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setForegroundAccuracy, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setBackgroundAccuracy, CAPPluginReturnPromise);
)