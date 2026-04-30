package app.fraterna.beta

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Base64
import android.util.Log
import org.json.JSONObject

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON" &&
            intent.action != "com.htc.intent.action.QUICKBOOT_POWERON") {
            return
        }

        Log.d("FraternaBoot", "Boot completed, checking if we should start location service...")

        val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val accessToken = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null)

        if (accessToken == null) {
            Log.d("FraternaBoot", "No auth token found, skipping service start")
            return
        }

        // Check if token is expired before starting service
        try {
            val tokenJson = JSONObject(accessToken)
            val accessTokenValue = tokenJson.optString("access_token", null)
            if (accessTokenValue != null) {
                val parts = accessTokenValue.split(".")
                if (parts.size == 3) {
                    val payload = String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
                    val exp = JSONObject(payload).optLong("exp", 0)
                    val now = System.currentTimeMillis() / 1000
                    if (exp > 0 && exp < now) {
                        Log.d("FraternaBoot", "Token expired, skipping service start")
                        return
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("FraternaBoot", "Error checking token expiry: ${e.message}")
        }

        // On Android 12+, check if we can start a foreground service from background
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? android.app.ActivityManager
            if (activityManager != null && !activityManager.isBackgroundStartAllowed) {
                Log.w("FraternaBoot", "Background start not allowed on Android 12+, service will start when app opens")
                return
            }
        }

        try {
            LocationForegroundService.start(context)
            Log.d("FraternaBoot", "Location service start requested successfully")
        } catch (e: Exception) {
            Log.e("FraternaBoot", "Failed to start location service: ${e.javaClass.simpleName}: ${e.message}")
        }
    }
}