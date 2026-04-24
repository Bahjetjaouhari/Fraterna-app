package app.fraterna.beta

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "LocationService",
    permissions = [
        Permission(
            alias = "location",
            strings = [
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ]
        ),
        Permission(
            alias = "backgroundLocation",
            strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION]
        )
    ]
)
class LocationPlugin : Plugin() {

    override fun load() {
        // Plugin loaded
    }

    @PluginMethod
    fun startLocationService(call: PluginCall) {
        val context: Context = activity.applicationContext

        // Check location permissions
        if (!hasLocationPermissions()) {
            requestAllPermissions(call, "startLocationServiceCallback")
            return
        }

        // For Android 10+, we need background location permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (!hasBackgroundLocationPermission()) {
                requestPermissionForAlias("backgroundLocation", call, "startLocationServiceCallback")
                return
            }
        }

        // Request battery optimization exemption so Doze mode doesn't throttle heartbeat requests
        requestBatteryOptimizationExemption(context)

        try {
            LocationForegroundService.start(context)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to start location service: ${e.message}")
        }
    }

    /**
     * Requests the system to exempt this app from battery optimizations (Doze mode).
     * Without this, Android will throttle network requests after a few minutes of screen-off,
     * causing heartbeat failures and the user appearing "offline".
     */
    private fun requestBatteryOptimizationExemption(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(context.packageName)) {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${context.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                    android.util.Log.d("LocationPlugin", "Requested battery optimization exemption")
                } catch (e: Exception) {
                    android.util.Log.e("LocationPlugin", "Failed to request battery optimization: ${e.message}")
                }
            } else {
                android.util.Log.d("LocationPlugin", "Already exempt from battery optimizations")
            }
        }
    }

    @PluginMethod
    fun stopLocationService(call: PluginCall) {
        val context: Context = activity.applicationContext
        try {
            LocationForegroundService.stop(context)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to stop location service: ${e.message}")
        }
    }

    @PluginMethod
    fun isServiceRunning(call: PluginCall) {
        val running = LocationForegroundService.isServiceRunning()
        val ret = JSObject()
        ret.put("running", running)
        call.resolve(ret)
    }

    @PluginMethod
    fun getLastKnownLocation(call: PluginCall) {
        val prefs = context.getSharedPreferences("fraterna_location", Context.MODE_PRIVATE)
        val lat = prefs.getFloat("lat", 0f).toDouble()
        val lng = prefs.getFloat("lng", 0f).toDouble()
        val accuracy = prefs.getFloat("accuracy", 0f).toDouble()
        val timestamp = prefs.getLong("timestamp", 0)

        if (timestamp == 0L) {
            call.reject("No location available")
            return
        }

        val ret = JSObject()
        ret.put("latitude", lat)
        ret.put("longitude", lng)
        ret.put("accuracy", accuracy)
        ret.put("timestamp", timestamp)
        call.resolve(ret)
    }

    @PermissionCallback
    private fun startLocationServiceCallback(call: PluginCall) {
        if (hasLocationPermissions() && hasBackgroundLocationPermission()) {
            startLocationService(call)
        } else {
            call.reject("Location permissions denied")
        }
    }

    private fun hasLocationPermissions(): Boolean {
        val fineLocation = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarseLocation = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return fineLocation || coarseLocation
    }

    private fun hasBackgroundLocationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }
}