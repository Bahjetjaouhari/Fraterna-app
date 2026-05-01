package app.fraterna.beta

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * HeartbeatAlarmReceiver — fired by AlarmManager every 90 seconds.
 * 
 * Unlike coroutine delay(), AlarmManager.setExactAndAllowWhileIdle()
 * survives Android Doze mode and app standby. This ensures the heartbeat
 * is sent even when the CPU is sleeping.
 * 
 * Flow:
 * 1. AlarmManager fires this receiver
 * 2. We tell the LocationForegroundService to send a heartbeat
 * 3. We reschedule the next alarm (one-shot pattern for reliability)
 */
class HeartbeatAlarmReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "HeartbeatAlarm"
        const val ACTION_HEARTBEAT = "app.fraterna.beta.action.HEARTBEAT_ALARM"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_HEARTBEAT) return

        Log.d(TAG, "Heartbeat alarm fired")

        if (!LocationForegroundService.isServiceRunning()) {
            Log.w(TAG, "Service not running, skipping heartbeat")
            return
        }

        // Tell the service to send a heartbeat now
        val heartbeatIntent = Intent(context, LocationForegroundService::class.java).apply {
            action = LocationForegroundService.ACTION_HEARTBEAT
        }
        context.startService(heartbeatIntent)

        // Reschedule next alarm (one-shot pattern is more reliable than repeating)
        LocationForegroundService.scheduleNextHeartbeatAlarm(context)
    }
}
