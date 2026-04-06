package app.fraterna.beta

import com.getcapacitor.BridgeActivity
import android.os.Bundle
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

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
}