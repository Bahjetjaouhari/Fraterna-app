package app.fraterna.beta

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON" ||
            intent.action == "com.htc.intent.action.QUICKBOOT_POWERON") {
            Log.d("FraternaBoot", "Boot completed, checking if we should start location service...")

            // Check if user is logged in before starting the service
            val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            val accessToken = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null)

            if (accessToken == null) {
                Log.d("FraternaBoot", "No auth token found, skipping service start")
                return
            }

            try {
                LocationForegroundService.start(context)
                Log.d("FraternaBoot", "Location service start requested successfully")
            } catch (e: Exception) {
                Log.e("FraternaBoot", "Failed to start location service: ${e.javaClass.simpleName}: ${e.message}")
                // On Android 12+ (API 31+), starting a foreground service from background
                // may throw ForegroundServiceStartNotAllowedException if the app doesn't have
                // "Allow all the time" location permission. The service will start when the
                // user opens the app next time.
            }
        }
    }
}