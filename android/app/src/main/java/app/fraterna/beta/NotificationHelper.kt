package app.fraterna.beta

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

object NotificationHelper {

    const val CHANNEL_ID_DEFAULT = "default"
    const val CHANNEL_ID_MESSAGES = "messages"
    const val CHANNEL_ID_EMERGENCY = "emergency"

    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Default channel - high importance for all notifications
            val defaultChannel = NotificationChannel(
                CHANNEL_ID_DEFAULT,
                "Notificaciones",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notificaciones generales de Fraterna"
                enableLights(true)
                enableVibration(true)
                setShowBadge(true)
            }

            // Messages channel
            val messagesChannel = NotificationChannel(
                CHANNEL_ID_MESSAGES,
                "Mensajes",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Mensajes de chat"
                enableLights(true)
                enableVibration(true)
                setShowBadge(true)
            }

            // Emergency channel - maximum importance
            val emergencyChannel = NotificationChannel(
                CHANNEL_ID_EMERGENCY,
                "Emergencias",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alertas de emergencia"
                enableLights(true)
                enableVibration(true)
                setShowBadge(true)
            }

            notificationManager.createNotificationChannels(listOf(
                defaultChannel,
                messagesChannel,
                emergencyChannel
            ))
        }
    }
}