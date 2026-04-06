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

        // Clear all notifications and badge when app is opened
        clearAllNotifications()

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
        // Clear notifications and badge when app comes to foreground
        clearAllNotifications()
    }

    private fun clearAllNotifications() {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancelAll()
            Log.d(TAG, "All notifications cleared")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing notifications: ${e.message}")
        }
    }
}