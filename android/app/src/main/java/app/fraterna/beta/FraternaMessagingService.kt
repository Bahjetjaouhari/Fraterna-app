package app.fraterna.beta

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import app.fraterna.beta.MainActivity

/**
 * Custom Firebase Messaging Service that handles push notifications
 * in all app states: foreground, background, and killed.
 *
 * This service is necessary because @capacitor/push-notifications plugin
 * doesn't handle notifications when the app is in killed state.
 */
class FraternaMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FraternaFCM"

        // Store the last token for access from JS
        @Volatile
        var lastToken: String? = null
            internal set
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "=== FCM TOKEN RECEIVED ===")
        Log.d(TAG, "Token: $token")
        lastToken = token

        // Broadcast token to the app if it's running
        try {
            val intent = Intent("app.fraterna.beta.FCM_TOKEN").apply {
                putExtra("token", token)
                setPackage(packageName)
            }
            sendBroadcast(intent)
            Log.d(TAG, "Token broadcast sent to app")
        } catch (e: Exception) {
            Log.e(TAG, "Error broadcasting token: ${e.message}")
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "=== MESSAGE RECEIVED ===")
        Log.d(TAG, "From: ${remoteMessage.from}")
        Log.d(TAG, "MessageId: ${remoteMessage.messageId}")
        Log.d(TAG, "MessageType: ${remoteMessage.messageType}")
        Log.d(TAG, "Data: ${remoteMessage.data}")

        // Check if message contains notification payload
        remoteMessage.notification?.let {
            Log.d(TAG, "Notification Title: ${it.title}")
            Log.d(TAG, "Notification Body: ${it.body}")
            Log.d(TAG, "Notification Channel: ${it.channelId}")
        }

        // Always show notification - our service handles all states
        handleRemoteMessage(remoteMessage)
    }

    /**
     * Handle remote message (both data and notification payloads)
     */
    private fun handleRemoteMessage(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        val notification = remoteMessage.notification

        // Extract title and body from notification or data payload
        val title = notification?.title
            ?: data["title"]
            ?: data["notification_title"]
            ?: "Fraterna"

        val body = notification?.body
            ?: data["body"]
            ?: data["message"]
            ?: data["notification_body"]
            ?: ""

        val channelId = getChannelIdFromData(data)

        Log.d(TAG, "Processing message - Title: $title, Body: $body, Channel: $channelId")

        sendNotification(
            title = title,
            body = body,
            channelId = channelId,
            data = data
        )
    }

    /**
     * Determine the appropriate notification channel based on message type
     */
    private fun getChannelIdFromData(data: Map<String, String>): String {
        val type = data["type"] ?: data["notification_type"] ?: ""
        return when (type) {
            "emergency_message" -> NotificationHelper.CHANNEL_ID_EMERGENCY
            "global_message", "friend_request", "friend_accepted" -> NotificationHelper.CHANNEL_ID_MESSAGES
            else -> NotificationHelper.CHANNEL_ID_DEFAULT
        }
    }

    /**
     * Create and show a notification
     */
    private fun sendNotification(
        title: String,
        body: String,
        channelId: String,
        data: Map<String, String>
    ) {
        Log.d(TAG, "sendNotification called - title: $title, body: $body, channel: $channelId")

        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            // Pass data to the activity for handling
            data.forEach { (key, value) ->
                putExtra(key, value)
            }
            putExtra("from_fcm", true)
            putExtra("notification_title", title)
            putExtra("notification_body", body)
        }

        val requestCode = System.currentTimeMillis().toInt()
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            requestCode,
            intent,
            pendingIntentFlags
        )

        val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val notificationBuilder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setSound(defaultSoundUri)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setShowWhen(true)

        // Emergency notifications: extra attention
        if (channelId == NotificationHelper.CHANNEL_ID_EMERGENCY) {
            notificationBuilder
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVibrate(longArrayOf(0, 500, 200, 500))
        }

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Ensure channels exist
        NotificationHelper.createNotificationChannels(this)

        // Use unique notification ID based on timestamp or message ID
        val notificationId = data["message_id"]?.hashCode() ?: System.currentTimeMillis().toInt()

        try {
            notificationManager.notify(notificationId, notificationBuilder.build())
            Log.d(TAG, "=== NOTIFICATION DISPLAYED SUCCESSFULLY ===")
            Log.d(TAG, "NotificationId: $notificationId, Title: $title, Channel: $channelId")
        } catch (e: Exception) {
            Log.e(TAG, "Error displaying notification: ${e.message}")
            e.printStackTrace()
        }
    }
}