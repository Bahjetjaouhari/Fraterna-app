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
            Log.d("FraternaBoot", "Boot completed, starting location service...")

            // Check if user is logged in before starting the service
            val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            val accessToken = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null)

            if (accessToken != null) {
                LocationForegroundService.start(context)
            } else {
                Log.d("FraternaBoot", "No auth token found, skipping service start")
            }
        }
    }
}