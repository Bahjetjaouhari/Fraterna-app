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
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token received: $token")
        // Token is automatically handled by Supabase on the JS side
        // but we log it here for debugging
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "Message received from: ${remoteMessage.from}")

        // Check if message contains data payload
        if (remoteMessage.data.isNotEmpty()) {
            Log.d(TAG, "Message data payload: ${remoteMessage.data}")
            handleDataMessage(remoteMessage)
        }

        // Check if message contains notification payload
        remoteMessage.notification?.let {
            Log.d(TAG, "Message notification: ${it.title} - ${it.body}")
            sendNotification(
                title = it.title ?: "Fraterna",
                body = it.body ?: "",
                channelId = getChannelIdFromData(remoteMessage.data),
                data = remoteMessage.data
            )
        }
    }

    /**
     * Handle data-only messages (no notification payload)
     * These are messages sent with data payload only from the server
     */
    private fun handleDataMessage(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        val title = data["title"] ?: data["notification_title"] ?: "Fraterna"
        val body = data["body"] ?: data["message"] ?: data["notification_body"] ?: ""
        val channelId = getChannelIdFromData(data)

        if (body.isNotEmpty()) {
            sendNotification(
                title = title,
                body = body,
                channelId = channelId,
                data = data
            )
        }
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
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            // Pass data to the activity for handling
            data.forEach { (key, value) ->
                putExtra(key, value)
            }
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
        notificationManager.notify(notificationId, notificationBuilder.build())

        Log.d(TAG, "Notification displayed: $title - $body (channel: $channelId)")
    }
}