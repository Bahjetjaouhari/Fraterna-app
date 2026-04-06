package app.fraterna.beta

import com.getcapacitor.BridgeActivity
import android.os.Bundle

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Create notification channels for Android 8+
        NotificationHelper.createNotificationChannels(this)

        // Register custom plugins
        registerPlugin(LocationPlugin::class.java)

        super.onCreate(savedInstanceState)
    }
}