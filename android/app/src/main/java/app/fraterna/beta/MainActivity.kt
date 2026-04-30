package app.fraterna.beta

import com.getcapacitor.BridgeActivity
import android.os.Bundle
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import android.app.NotificationManager
import android.content.Context

class MainActivity : BridgeActivity() {
    companion object {
        private const val TAG = "FraternaMainActivity"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Create notification channels for Android 8+
        NotificationHelper.createNotificationChannels(this)

        // Register custom plugins
        registerPlugin(LocationPlugin::class.java)

        super.onCreate(savedInstanceState)

        // Clear only proximity and message notifications (not the foreground service notification)
        clearNonServiceNotifications()

        // Explicitly initialize Firebase and log status
        try {
            val firebaseApp = FirebaseApp.initializeApp(this)
            Log.d(TAG, "=== FIREBASE INIT STATUS ===")
            Log.d(TAG, "FirebaseApp initialized: ${firebaseApp != null}")
            Log.d(TAG, "FirebaseApp name: ${firebaseApp?.name}")
            Log.d(TAG, "FirebaseApp options: ${firebaseApp?.options}")

            // Get FCM token
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    Log.d(TAG, "=== FCM TOKEN ===")
                    Log.d(TAG, "Token: ${task.result}")
                    FraternaMessagingService.lastToken = task.result
                } else {
                    Log.e(TAG, "Failed to get FCM token: ${task.exception?.message}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Firebase initialization error: ${e.message}")
            e.printStackTrace()
        }
    }

    override fun onResume() {
        super.onResume()
        clearNonServiceNotifications()
    }

    /**
     * Clear all notifications EXCEPT the foreground service notification (ID 1001).
     * Cancelling the foreground service notification can kill the service on Android 13+.
     */
    private fun clearNonServiceNotifications() {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            // Cancel proximity notifications and message notifications by their specific channels
            // rather than using cancelAll() which kills the foreground service notification
            notificationManager.deleteNotificationChannel(LocationForegroundService.CHANNEL_ID_PROXIMITY)
            // Recreate it immediately so future alerts work
            NotificationHelper.createNotificationChannels(this)
            Log.d(TAG, "Non-service notifications cleared")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing notifications: ${e.message}")
        }
    }
}