package app.fraterna.beta

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import kotlin.math.*

class LocationForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "fraterna_location_channel"
        const val CHANNEL_ID_PROXIMITY = "fraterna_proximity_channel"
        const val CHANNEL_NAME = "Ubicación activa"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "app.fraterna.beta.action.START_LOCATION"
        const val ACTION_STOP = "app.fraterna.beta.action.STOP_LOCATION"

        private var isRunning = false

        fun isServiceRunning(): Boolean = isRunning

        fun start(context: Context) {
            val intent = Intent(context, LocationForegroundService::class.java).apply {
                action = ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, LocationForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var fusedLocationClient: FusedLocationProviderClient? = null
    private var locationCallback: LocationCallback? = null
    private val httpClient = OkHttpClient()

    // User session data
    private var currentUserId: String? = null
    private var bearerToken: String? = null
    private var profileSettings: ProfileSettings? = null

    // Proximity alert tracking
    private val proximityCooldowns = mutableMapOf<String, Long>()
    private val PROXIMITY_COOLDOWN_MS = 2 * 60 * 1000L // 2 minutes

    // Supabase config
    private val supabaseUrl = "https://vzlbvknauwvrqwpvtaqe.supabase.co"
    private val supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6bGJ2a25hdXd2cnF3cHZ0YXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NzUwODUsImV4cCI6MjA4NDQ1MTA4NX0.XlPQBEKzv-RxOnTD1pbS-5A_J5xavLqwpWH9IAC5kOw"

    data class ProfileSettings(
        val proximityRadiusKm: Double = 5.0,
        val proximityAlertsEnabled: Boolean = true
    )

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startLocationUpdates()
            ACTION_STOP -> stopLocationUpdates()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Location channel (low priority, ongoing)
            val locationChannel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Fraterna está rastreando tu ubicación"
                setShowBadge(false)
            }

            // Proximity alert channel (high priority)
            val proximityChannel = NotificationChannel(
                CHANNEL_ID_PROXIMITY,
                "Alertas de proximidad",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notificaciones cuando un QH está cerca"
                setShowBadge(true)
                enableVibration(true)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(locationChannel)
            notificationManager.createNotificationChannel(proximityChannel)
        }
    }

    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Fraterna")
            .setContentText("Ubicación activa")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun startLocationUpdates() {
        isRunning = true
        startForeground(NOTIFICATION_ID, createNotification())

        // Load user session
        loadUserSession()

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            15000L // Update interval: 15 seconds
        ).apply {
            setMinUpdateIntervalMillis(10000L) // Fastest interval: 10 seconds
            setWaitForAccurateLocation(true)
            setMaxUpdateDelayMillis(30000L) // Max delay: 30 seconds
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                locationResult.lastLocation?.let { location ->
                    sendLocationToWebView(location)
                    sendHeartbeat()
                    checkProximityAlerts(location)
                }
            }
        }

        try {
            fusedLocationClient?.requestLocationUpdates(
                locationRequest,
                locationCallback!!,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            android.util.Log.e("LocationService", "Security exception: ${e.message}")
            stopSelf()
        }
    }

    private fun stopLocationUpdates() {
        isRunning = false
        locationCallback?.let {
            fusedLocationClient?.removeLocationUpdates(it)
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun loadUserSession() {
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val accessToken = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null)

        if (accessToken == null) {
            android.util.Log.d("LocationService", "No auth token found")
            return
        }

        try {
            val tokenJson = JSONObject(accessToken)
            val userObj = tokenJson.optJSONObject("user")
            currentUserId = userObj?.optString("id", null)
            bearerToken = tokenJson.optString("access_token", null)

            // Load profile settings
            loadProfileSettings()
        } catch (e: Exception) {
            android.util.Log.e("LocationService", "Error parsing auth token: ${e.message}")
        }
    }

    private fun loadProfileSettings() {
        val userId = currentUserId ?: return
        val token = bearerToken ?: return

        serviceScope.launch {
            try {
                val request = Request.Builder()
                    .url("$supabaseUrl/rest/v1/profiles?id=eq.$userId&select=proximity_radius_km,proximity_alerts_enabled")
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("apikey", supabaseAnonKey)
                    .get()
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    val responseBody = response.body?.string()
                    if (!responseBody.isNullOrEmpty()) {
                        // Parse the response - it's an array
                        val jsonArray = org.json.JSONArray(responseBody)
                        if (jsonArray.length() > 0) {
                            val profile = jsonArray.getJSONObject(0)
                            val radius = profile.optDouble("proximity_radius_km", 5.0)
                            val enabled = profile.optBoolean("proximity_alerts_enabled", true)

                            profileSettings = ProfileSettings(
                                proximityRadiusKm = radius,
                                proximityAlertsEnabled = enabled
                            )
                            android.util.Log.d("LocationService", "Profile settings loaded: radius=$radius km, enabled=$enabled")
                        }
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Error loading profile settings: ${e.message}")
            }
        }
    }

    private fun sendLocationToWebView(location: Location) {
        val prefs = getSharedPreferences("fraterna_location", Context.MODE_PRIVATE)
        prefs.edit().apply {
            putFloat("lat", location.latitude.toFloat())
            putFloat("lng", location.longitude.toFloat())
            putFloat("accuracy", location.accuracy)
            putLong("timestamp", System.currentTimeMillis())
            apply()
        }

        val intent = Intent("app.fraterna.beta.LOCATION_UPDATE").apply {
            putExtra("lat", location.latitude)
            putExtra("lng", location.longitude)
            putExtra("accuracy", location.accuracy)
        }
        sendBroadcast(intent)
    }

    private fun sendHeartbeat() {
        val userId = currentUserId ?: return
        val token = bearerToken ?: return

        serviceScope.launch {
            try {
                val jsonBody = JSONObject().apply {
                    put("last_heartbeat_at", java.time.Instant.now().toString())
                }

                val requestBody = jsonBody.toString().toRequestBody("application/json".toMediaType())

                val request = Request.Builder()
                    .url("$supabaseUrl/rest/v1/profiles?id=eq.$userId")
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("apikey", supabaseAnonKey)
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=minimal")
                    .patch(requestBody)
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    android.util.Log.d("LocationService", "Heartbeat sent successfully")
                } else {
                    android.util.Log.e("LocationService", "Heartbeat failed: ${response.code}")
                }
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Heartbeat error: ${e.message}")
            }
        }
    }

    private fun checkProximityAlerts(location: Location) {
        val settings = profileSettings
        val userId = currentUserId ?: return
        val token = bearerToken ?: return
        val myLat = location.latitude
        val myLng = location.longitude

        serviceScope.launch {
            try {
                // First, reload profile settings to get latest values
                val settingsRequest = Request.Builder()
                    .url("$supabaseUrl/rest/v1/profiles?id=eq.$userId&select=proximity_radius_km,proximity_alerts_enabled")
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("apikey", supabaseAnonKey)
                    .get()
                    .build()

                val settingsResponse = httpClient.newCall(settingsRequest).execute()
                var alertsEnabled = settings?.proximityAlertsEnabled ?: true
                var radiusKm = settings?.proximityRadiusKm ?: 5.0

                if (settingsResponse.isSuccessful) {
                    val settingsBody = settingsResponse.body?.string()
                    if (!settingsBody.isNullOrEmpty()) {
                        val settingsArray = org.json.JSONArray(settingsBody)
                        if (settingsArray.length() > 0) {
                            val profileObj = settingsArray.getJSONObject(0)
                            alertsEnabled = profileObj.optBoolean("proximity_alerts_enabled", true)
                            radiusKm = profileObj.optDouble("proximity_radius_km", 5.0)

                            // Update cached settings
                            profileSettings = ProfileSettings(
                                proximityRadiusKm = radiusKm,
                                proximityAlertsEnabled = alertsEnabled
                            )

                            android.util.Log.d("LocationService", "Settings refreshed: alertsEnabled=$alertsEnabled, radiusKm=$radiusKm")
                        }
                    }
                }

                // Check if alerts are disabled
                if (!alertsEnabled) {
                    android.util.Log.d("LocationService", "Proximity alerts disabled in settings, skipping")
                    return@launch
                }
                if (radiusKm <= 0) {
                    android.util.Log.d("LocationService", "Proximity radius is 0, skipping")
                    return@launch
                }

                // Fetch nearby users with their locations
                // We need users who:
                // 1. Are not the current user
                // 2. Have tracking_enabled = true
                // 3. Don't have stealth_mode = true
                // 4. Have a recent heartbeat (online)
                // 5. Have a location
                val request = Request.Builder()
                    .url("""
                        $supabaseUrl/rest/v1/locations?select=*,profile:profiles!locations_user_id_fkey(id,full_name,stealth_mode,tracking_enabled,last_heartbeat_at)&user_id=neq.$userId
                    """.trimIndent().replace("\n", "").replace(" ", ""))
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("apikey", supabaseAnonKey)
                    .get()
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    val responseBody = response.body?.string()
                    if (!responseBody.isNullOrEmpty()) {
                        val locationsArray = org.json.JSONArray(responseBody)

                        for (i in 0 until locationsArray.length()) {
                            val locationObj = locationsArray.getJSONObject(i)
                            val lat = locationObj.optDouble("lat", Double.NaN)
                            val lng = locationObj.optDouble("lng", Double.NaN)

                            if (lat.isNaN() || lng.isNaN()) continue

                            val profileObj = locationObj.optJSONObject("profile")
                            if (profileObj == null) continue

                            // Skip if stealth_mode is true (ghost mode)
                            if (profileObj.optBoolean("stealth_mode", false)) {
                                android.util.Log.d("LocationService", "Skipping user in ghost mode")
                                continue
                            }

                            // Skip if tracking_enabled is false
                            if (!profileObj.optBoolean("tracking_enabled", true)) {
                                android.util.Log.d("LocationService", "Skipping user with tracking disabled")
                                continue
                            }

                            // Check heartbeat - user is online if they have a heartbeat (app installed and logged in)
                            val lastHeartbeat = profileObj.optString("last_heartbeat_at", null)
                            if (lastHeartbeat.isNullOrEmpty()) {
                                android.util.Log.d("LocationService", "Skipping user with no heartbeat (not logged in)")
                                continue
                            }
                            // User is considered online as long as last_heartbeat_at is not null
                            // (only cleared on explicit logout)

                            // Calculate distance
                            val distance = haversineDistance(myLat, myLng, lat, lng)

                            if (distance <= radiusKm) {
                                val brotherId = profileObj.optString("id", "")
                                val brotherName = profileObj.optString("full_name", "Un QH")

                                // Check cooldown
                                val now = System.currentTimeMillis()
                                val lastNotified = proximityCooldowns[brotherId] ?: 0L

                                if (now - lastNotified >= PROXIMITY_COOLDOWN_MS) {
                                    proximityCooldowns[brotherId] = now
                                    showProximityNotification(brotherName, distance, radiusKm)
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Proximity check error: ${e.message}")
            }
        }
    }

    private fun haversineDistance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R = 6371.0 // Earth's radius in km
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2)
        val c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

    private var notificationIdCounter = 2000

    private fun showProximityNotification(brotherName: String, distanceKm: Double, radiusKm: Double) {
        val notificationManager = getSystemService(NotificationManager::class.java)

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID_PROXIMITY)
            .setContentTitle("QH Cerca")
            .setContentText("$brotherName está a ${"%.2f".format(distanceKm)} km (radio ${"%.0f".format(radiusKm)} km)")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        notificationManager.notify(notificationIdCounter++, notification)
        android.util.Log.d("LocationService", "Proximity notification shown for $brotherName")
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        serviceScope.cancel()
        locationCallback?.let {
            fusedLocationClient?.removeLocationUpdates(it)
        }
    }
}