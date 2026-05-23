package app.fraterna.beta

import android.app.AlarmManager
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
import android.os.PowerManager
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleObserver
import androidx.lifecycle.OnLifecycleEvent
import androidx.lifecycle.ProcessLifecycleOwner
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.*

class LocationForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "fraterna_location_channel"
        const val CHANNEL_ID_PROXIMITY = "fraterna_proximity_channel"
        const val CHANNEL_NAME = "Ubicación activa"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "app.fraterna.beta.action.START_LOCATION"
        const val ACTION_STOP = "app.fraterna.beta.action.STOP_LOCATION"
        const val ACTION_HEARTBEAT = "app.fraterna.beta.action.HEARTBEAT_ALARM"
        const val ACTION_UPDATE_TOKEN = "app.fraterna.beta.action.UPDATE_TOKEN"
        const val EXTRA_AUTH_TOKEN = "app.fraterna.beta.extra.AUTH_TOKEN"
        const val EXTRA_USER_ID = "app.fraterna.beta.extra.USER_ID"
        const val ONLINE_THRESHOLD_SECONDS = 600L // Must match is_user_active() SQL function (10 minutes)
        private const val HEARTBEAT_ALARM_INTERVAL_MS = 90_000L // 90 seconds
        private const val HEARTBEAT_ALARM_REQUEST_CODE = 9001

        /**
         * Schedule the next heartbeat alarm using AlarmManager.
         * Uses setExactAndAllowWhileIdle() which fires even in Doze mode.
         * Called from HeartbeatAlarmReceiver after each heartbeat completes.
         */
        fun scheduleNextHeartbeatAlarm(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, HeartbeatAlarmReceiver::class.java).apply {
                action = HeartbeatAlarmReceiver.ACTION_HEARTBEAT
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                HEARTBEAT_ALARM_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val triggerAt = System.currentTimeMillis() + HEARTBEAT_ALARM_INTERVAL_MS

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        triggerAt,
                        pendingIntent
                    )
                } else {
                    alarmManager.setExact(
                        AlarmManager.RTC_WAKEUP,
                        triggerAt,
                        pendingIntent
                    )
                }
                android.util.Log.d("LocationService", "Next heartbeat alarm scheduled in ${HEARTBEAT_ALARM_INTERVAL_MS / 1000}s")
            } catch (e: SecurityException) {
                android.util.Log.e("LocationService", "Cannot schedule exact alarm: ${e.message}")
                // Fallback: use inexact alarm (may be delayed by Doze but still fires)
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            }
        }

        /**
         * Cancel any pending heartbeat alarm.
         */
        fun cancelHeartbeatAlarm(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, HeartbeatAlarmReceiver::class.java).apply {
                action = HeartbeatAlarmReceiver.ACTION_HEARTBEAT
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                HEARTBEAT_ALARM_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.cancel(pendingIntent)
            android.util.Log.d("LocationService", "Heartbeat alarm cancelled")
        }

        @Volatile
        private var isRunning = false

        // User session data — shared between companion (static) and instance methods
        @Volatile
        var currentUserId: String? = null
            internal set

        @Volatile
        var bearerToken: String? = null
            internal set

        // Application context for writing to SharedPreferences from static methods
        @Volatile
        private var appContext: Context? = null

        // JS bridge can update these from the webview
        @Volatile
        var trackingEnabledFromJS: Boolean = true

        @Volatile
        var backgroundMode: Boolean = false

        @Volatile
        var stealthModeFromJS: Boolean = false

        fun isServiceRunning(): Boolean = isRunning

        fun start(context: Context, authToken: String? = null, userId: String? = null) {
            appContext = context.applicationContext
            val intent = Intent(context, LocationForegroundService::class.java).apply {
                action = ACTION_START
                authToken?.let { putExtra(EXTRA_AUTH_TOKEN, it) }
                userId?.let { putExtra(EXTRA_USER_ID, it) }
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

        fun setTrackingEnabled(enabled: Boolean) {
            trackingEnabledFromJS = enabled
        }

        fun setStealthMode(enabled: Boolean) {
            stealthModeFromJS = enabled
        }

        fun updateBackgroundMode(bg: Boolean) {
            backgroundMode = bg
        }

        fun updateAuthToken(authToken: String, userId: String? = null) {
            bearerToken = authToken
            if (userId != null) {
                currentUserId = userId
            }
            // Persist to SharedPreferences so subsequent reads and 401 recovery find the fresh token
            appContext?.let { ctx ->
                try {
                    val prefs = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                    val storedJson = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null)
                    if (storedJson != null) {
                        val tokenJson = org.json.JSONObject(storedJson)
                        tokenJson.put("access_token", authToken)
                        if (userId != null) {
                            val userObj = tokenJson.optJSONObject("user")
                            if (userObj != null) {
                                userObj.put("id", userId)
                                tokenJson.put("user", userObj)
                            }
                        }
                        prefs.edit().putString("sb-vzlbvknauwvrqwpvtaqe-auth-token", tokenJson.toString()).apply()
                    }
                } catch (e: Exception) {
                    android.util.Log.e("LocationService", "Error persisting token to SharedPreferences: ${e.message}")
                }
            }
            android.util.Log.d("LocationService", "Auth token updated from JS bridge (persisted)")
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var fusedLocationClient: FusedLocationProviderClient? = null
    private var locationCallback: LocationCallback? = null
    // heartbeatTimerJob removed — now using AlarmManager via HeartbeatAlarmReceiver

    // OkHttpClient with proper timeouts to prevent hangs on poor connectivity
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private var wakeLock: PowerManager.WakeLock? = null

    // User session data — accessed from instance methods and companion object (static updateAuthToken)
    // These reference the companion-level volatile fields
    private var currentUserId: String?
        get() = Companion.currentUserId
        set(value) { Companion.currentUserId = value }
    private var bearerToken: String?
        get() = Companion.bearerToken
        set(value) { Companion.bearerToken = value }
    @Volatile
    private var currentUserName: String? = null

    @Volatile
    private var profileSettings: ProfileSettings? = null

    // Privacy flags — checked before uploading location
    private var stealthMode: Boolean
        get() = Companion.stealthModeFromJS
        set(value) { Companion.stealthModeFromJS = value }
    @Volatile
    private var trackingEnabledFromProfile: Boolean = true

    // Proximity alert tracking (thread-safe)
    private val proximityCooldowns = ConcurrentHashMap<String, Long>()
    private val PROXIMITY_COOLDOWN_MS = 5 * 60 * 1000L // 5 minutes

    // Profile settings cache TTL (avoid fetching every 15s)
    @Volatile
    private var profileSettingsLastFetchMs: Long = 0
    private val PROFILE_SETTINGS_TTL_MS = 5 * 60 * 1000L // 5 minutes

    // Session load retry limit
    private var sessionLoadRetries = 0
    private val MAX_SESSION_LOAD_RETRIES = 12 // 12 x 10s = 2 minutes max

    // Token refresh throttle (avoid 3x refresh per tick)
    @Volatile
    private var lastTokenRefreshMs: Long = 0
    private val TOKEN_REFRESH_THROTTLE_MS = 30_000L // 30 seconds

    // Notification ID counter (thread-safe)
    private val notificationIdCounter = AtomicInteger(2000)

    // Supabase config from BuildConfig (injected at build time from local.properties)
    private val supabaseUrl = "https://vzlbvknauwvrqwpvtaqe.supabase.co"
    // Hardcoded fallback — the anon key is public (used in browser JS), not a secret
    private val supabaseAnonKey = if (BuildConfig.SUPABASE_ANON_KEY.isNullOrEmpty()) {
        android.util.Log.e("LocationService", "⚠️ BuildConfig.SUPABASE_ANON_KEY is EMPTY — using hardcoded fallback")
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6bGJ2a25hdXd2cnF3cHZ0YXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NzUwODUsImV4cCI6MjA4NDQ1MTA4NX0.XlPQBEKzv-RxOnTD1pbS-5A_J5xavLqwpWH9IAC5kOw"
    } else {
        BuildConfig.SUPABASE_ANON_KEY
    }

    data class ProfileSettings(
        val proximityRadiusKm: Double = 5.0,
        val proximityAlertsEnabled: Boolean = true
    )

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        createNotificationChannels()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        // Monitor app lifecycle to adjust location accuracy between fg/bg
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : LifecycleObserver {
            @OnLifecycleEvent(Lifecycle.Event.ON_STOP)
            fun onAppBackgrounded() {
                android.util.Log.d("LocationService", "App moved to background — switching to balanced accuracy")
                backgroundMode = true
                restartLocationRequest()
            }

            @OnLifecycleEvent(Lifecycle.Event.ON_START)
            fun onAppForegrounded() {
                android.util.Log.d("LocationService", "App moved to foreground — switching to high accuracy")
                backgroundMode = false
                // Reset token refresh throttle and check SharedPreferences for fresh token
                // (JS client may have refreshed token while we were in background)
                lastTokenRefreshMs = 0
                refreshToken()
                restartLocationRequest()
            }
        })
    }

    /**
     * Re-registers location updates with current backgroundMode setting.
     * Called when app transitions between foreground and background.
     */
    private fun restartLocationRequest() {
        if (!isRunning) return
        locationCallback?.let {
            fusedLocationClient?.removeLocationUpdates(it)
        }

        val priority = if (backgroundMode) Priority.PRIORITY_BALANCED_POWER_ACCURACY else Priority.PRIORITY_HIGH_ACCURACY
        val intervalMs = if (backgroundMode) 30000L else 15000L

        val locationRequest = LocationRequest.Builder(priority, intervalMs).apply {
            setMinUpdateIntervalMillis(if (backgroundMode) 20000L else 10000L)
            setWaitForAccurateLocation(!backgroundMode)
            setMaxUpdateDelayMillis(if (backgroundMode) 60000L else 30000L)
        }.build()

        locationCallback?.let { callback ->
            try {
                fusedLocationClient?.requestLocationUpdates(locationRequest, callback, Looper.getMainLooper())
            } catch (e: SecurityException) {
                android.util.Log.e("LocationService", "Security exception on restart: ${e.message}")
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        when (action) {
            ACTION_START -> {
                val authToken = intent?.getStringExtra(EXTRA_AUTH_TOKEN)
                val userId = intent?.getStringExtra(EXTRA_USER_ID)
                startLocationUpdates(authToken, userId)
            }
            ACTION_STOP -> stopLocationUpdates()
            ACTION_HEARTBEAT -> handleHeartbeatAlarm()
            ACTION_UPDATE_TOKEN -> {
                val authToken = intent?.getStringExtra(EXTRA_AUTH_TOKEN)
                val userId = intent?.getStringExtra(EXTRA_USER_ID)
                if (authToken != null) {
                    bearerToken = authToken
                    if (userId != null) {
                        currentUserId = userId
                    }
                    android.util.Log.d("LocationService", "Auth token updated via ACTION_UPDATE_TOKEN")
                    // Also update SharedPreferences so subsequent reads get the fresh token
                    updateTokenInSharedPreferences(authToken, userId)
                }
            }
        }
        return START_STICKY
    }

    /**
     * Called by HeartbeatAlarmReceiver via startService(ACTION_HEARTBEAT).
     * Runs the heartbeat in a coroutine so the service stays alive during the network call.
     */
    private fun handleHeartbeatAlarm() {
        if (!isRunning) return
        serviceScope.launch {
            try {
                refreshToken()
                sendHeartbeat()
                loadProfileSettings()
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Heartbeat alarm handler error: ${e.message}")
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val locationChannel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Fraterna está rastreando tu ubicación"
                setShowBadge(false)
            }

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

    private fun startLocationUpdates(authToken: String? = null, userId: String? = null) {
        // Update token/userId if provided, even if already running
        if (!authToken.isNullOrEmpty()) {
            bearerToken = authToken
            android.util.Log.d("LocationService", "Auth token set from JS bridge")
            updateTokenInSharedPreferences(authToken, userId)
        }
        if (!userId.isNullOrEmpty()) {
            currentUserId = userId
            android.util.Log.d("LocationService", "User ID set from JS bridge: $userId")
        }

        // If already running, just update the token — don't re-acquire WakeLock or re-register location updates
        if (isRunning) {
            android.util.Log.d("LocationService", "Service already running, token updated (skipping re-init)")
            return
        }
        isRunning = true

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, createNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, createNotification())
        }

        acquireWakeLock()
        loadUserSession()
        startHeartbeatTimer()

        // Remove old callback before registering a new one (prevents duplicates on START_STICKY restart)
        locationCallback?.let {
            fusedLocationClient?.removeLocationUpdates(it)
        }

        // Adjust location request based on background mode
        val priority = if (backgroundMode) Priority.PRIORITY_BALANCED_POWER_ACCURACY else Priority.PRIORITY_HIGH_ACCURACY
        val intervalMs = if (backgroundMode) 30000L else 15000L

        val locationRequest = LocationRequest.Builder(
            priority,
            intervalMs
        ).apply {
            setMinUpdateIntervalMillis(if (backgroundMode) 20000L else 10000L)
            setWaitForAccurateLocation(!backgroundMode)
            setMaxUpdateDelayMillis(if (backgroundMode) 60000L else 30000L)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                locationResult.lastLocation?.let { location ->
                    sendLocationToWebView(location)
                    // Single coroutine per tick — refreshToken once, then call all methods
                    serviceScope.launch {
                        refreshToken()
                        sendHeartbeat()
                        updateLocationInSupabase(location)
                        checkProximityAlerts(location)
                    }
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

    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "fraterna:LocationServiceWakeLock"
        ).apply {
            // No timeout — held for the lifetime of the service, released in stopLocationUpdates()
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
            }
        }
        wakeLock = null
    }

    private fun stopLocationUpdates() {
        isRunning = false
        trackingEnabledFromJS = true
        backgroundMode = false
        sessionLoadRetries = 0
        stopHeartbeatTimer()
        locationCallback?.let {
            fusedLocationClient?.removeLocationUpdates(it)
        }
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * Start heartbeat using AlarmManager (survives Doze mode).
     * Uses setExactAndAllowWhileIdle() which fires even when the CPU is sleeping.
     * This replaces the previous coroutine delay() which was killed by Doze.
     */
    private fun startHeartbeatTimer() {
        stopHeartbeatTimer()
        scheduleNextHeartbeatAlarm(this)
        android.util.Log.d("LocationService", "Heartbeat AlarmManager started (90s interval, Doze-safe)")
    }

    private fun stopHeartbeatTimer() {
        cancelHeartbeatAlarm(this)
    }

    private fun loadUserSession() {
        // If authToken and userId were already set from JS bridge, skip SharedPreferences read
        if (bearerToken != null && currentUserId != null) {
            sessionLoadRetries = 0
            android.util.Log.d("LocationService", "Using auth token from JS bridge, skipping SharedPreferences")
            loadProfileSettings()
            return
        }

        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val accessToken = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null)

        if (accessToken == null) {
            sessionLoadRetries++
            if (sessionLoadRetries > MAX_SESSION_LOAD_RETRIES) {
                android.util.Log.e("LocationService", "Max session load retries exceeded, stopping service")
                stopLocationUpdates()
                return
            }
            android.util.Log.w("LocationService", "No auth token found, retry $sessionLoadRetries/$MAX_SESSION_LOAD_RETRIES in 10s...")
            serviceScope.launch {
                kotlinx.coroutines.delay(10000)
                loadUserSession()
            }
            return
        }

        try {
            val tokenJson = JSONObject(accessToken)
            val userObj = tokenJson.optJSONObject("user")
            val storedUserId = userObj?.optString("id", null)
            val storedAccessToken = tokenJson.optString("access_token", null)

            // Only override if not already set from JS bridge
            if (currentUserId == null) {
                currentUserId = storedUserId
            }
            if (bearerToken == null) {
                bearerToken = storedAccessToken
            }

            if (currentUserId == null) {
                bearerToken?.let { token ->
                    val parts = token.split(".")
                    if (parts.size == 3) {
                        val payload = String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
                        val payloadJson = JSONObject(payload)
                        currentUserId = payloadJson.optString("sub", null)
                    }
                }
            }

            if (currentUserId != null && bearerToken != null) {
                sessionLoadRetries = 0
                android.util.Log.d("LocationService", "Session loaded: userId=$currentUserId")
                loadProfileSettings()
            } else {
                sessionLoadRetries++
                if (sessionLoadRetries > MAX_SESSION_LOAD_RETRIES) {
                    android.util.Log.e("LocationService", "Max session load retries exceeded, stopping service")
                    stopLocationUpdates()
                    return
                }
                android.util.Log.w("LocationService", "Incomplete session data, retry $sessionLoadRetries/$MAX_SESSION_LOAD_RETRIES...")
                serviceScope.launch {
                    kotlinx.coroutines.delay(10000)
                    loadUserSession()
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("LocationService", "Error parsing auth token: ${e.message}")
        }
    }

    /**
     * Update SharedPreferences with the fresh auth token from the JS bridge.
     * This ensures subsequent reads (e.g. after service restart) get a valid token.
     */
    private fun updateTokenInSharedPreferences(authToken: String, userId: String? = null) {
        try {
            val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            val storedJson = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null)

            if (storedJson != null) {
                // Update the existing session JSON with the new access_token
                val tokenJson = JSONObject(storedJson)
                tokenJson.put("access_token", authToken)
                if (userId != null) {
                    val userObj = tokenJson.optJSONObject("user")
                    if (userObj != null) {
                        userObj.put("id", userId)
                        tokenJson.put("user", userObj)
                    }
                }
                prefs.edit()
                    .putString("sb-vzlbvknauwvrqwpvtaqe-auth-token", tokenJson.toString())
                    .apply()
                android.util.Log.d("LocationService", "Updated SharedPreferences with fresh auth token")
            } else {
                // No existing session in SharedPreferences — create a minimal one
                val newJson = JSONObject().apply {
                    put("access_token", authToken)
                    put("token_type", "bearer")
                    if (userId != null) {
                        val userObj = JSONObject().apply { put("id", userId) }
                        put("user", userObj)
                    }
                }
                prefs.edit()
                    .putString("sb-vzlbvknauwvrqwpvtaqe-auth-token", newJson.toString())
                    .apply()
                android.util.Log.d("LocationService", "Created new session in SharedPreferences with auth token")
            }
        } catch (e: Exception) {
            android.util.Log.e("LocationService", "Error updating SharedPreferences with auth token: ${e.message}")
        }
    }

    /**
     * Refresh auth token. Tries in order:
     * 1. Check SharedPreferences for a token newer than current (written by JS client)
     * 2. If current token is expired, attempt native Supabase refresh using the
     *    refresh_token from SharedPreferences. This works in background because
     *    the JS webview is suspended and hasn't consumed the refresh_token.
     */
    private fun refreshToken() {
        val now = System.currentTimeMillis()
        if (now - lastTokenRefreshMs < TOKEN_REFRESH_THROTTLE_MS) return
        lastTokenRefreshMs = now

        // Fast path: check if JS client already refreshed the token in storage
        if (updateTokenFromStorage()) return

        // Fallback: if current token is expired, try native Supabase refresh
        val currentToken = bearerToken ?: return
        if (isTokenExpired(currentToken)) {
            refreshTokenViaSupabase()
        }
    }

    /**
     * Check if a JWT token is expired by decoding the exp claim.
     */
    private fun isTokenExpired(token: String): Boolean {
        try {
            val parts = token.split(".")
            if (parts.size != 3) return true
            val payload = String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
            val payloadJson = JSONObject(payload)
            val exp = payloadJson.optLong("exp", 0)
            if (exp == 0L) return true
            val nowSeconds = System.currentTimeMillis() / 1000
            return nowSeconds >= exp
        } catch (e: Exception) {
            android.util.Log.e("LocationService", "Error decoding JWT: ${e.message}")
            return true
        }
    }

    /**
     * Attempt to refresh the auth token using Supabase's refresh_token endpoint.
     * Uses the refresh_token from SharedPreferences — this is valid in background
     * because the JS webview is suspended and hasn't consumed it.
     * After success, writes the complete new session to SharedPreferences so
     * the JS client can pick it up on resume.
     */
    private fun refreshTokenViaSupabase() {
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val storedJson = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null) ?: return

        try {
            val tokenJson = JSONObject(storedJson)
            val refreshToken = tokenJson.optString("refresh_token", null) ?: return

            android.util.Log.d("LocationService", "Token expired, attempting native Supabase refresh...")

            val body = JSONObject().apply { put("refresh_token", refreshToken) }
            val requestBody = body.toString().toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url("$supabaseUrl/auth/v1/token?grant_type=refresh_token")
                .addHeader("apikey", supabaseAnonKey)
                .addHeader("Content-Type", "application/json")
                .post(requestBody)
                .build()

            val response = httpClient.newCall(request).execute()
            val responseBody = response.body?.string()

            if (response.isSuccessful && responseBody != null) {
                val newSession = JSONObject(responseBody)
                val newAccessToken = newSession.optString("access_token", null)

                if (newAccessToken != null) {
                    bearerToken = newAccessToken
                    android.util.Log.d("LocationService", "✓ Token refreshed via Supabase (native)")

                    // Update userId if available
                    val userObj = newSession.optJSONObject("user")
                    if (userObj != null) {
                        val newUserId = userObj.optString("id", null)
                        if (newUserId != null) currentUserId = newUserId
                    }

                    // Write the complete new session to SharedPreferences
                    // so the JS client can pick it up on resume
                    tokenJson.put("access_token", newAccessToken)
                    val newRefreshToken = newSession.optString("refresh_token", null)
                    if (newRefreshToken != null) {
                        tokenJson.put("refresh_token", newRefreshToken)
                    }
                    tokenJson.put("expires_at", newSession.optLong("expires_at", 0))
                    tokenJson.put("expires_in", newSession.optInt("expires_in", 3600))
                    tokenJson.put("token_type", "bearer")

                    prefs.edit()
                        .putString("sb-vzlbvknauwvrqwpvtaqe-auth-token", tokenJson.toString())
                        .apply()
                    android.util.Log.d("LocationService", "New session written to SharedPreferences")
                }
            } else {
                val statusCode = response.code
                val errorBody = responseBody?.take(200) ?: "no body"
                android.util.Log.e("LocationService", "Native token refresh failed: $statusCode - $errorBody")
            }
        } catch (e: Exception) {
            android.util.Log.e("LocationService", "Native token refresh error: ${e.message}")
        }
    }



    /**
     * Load profile settings including privacy flags.
     * Uses cache with 5-minute TTL to avoid fetching every 15 seconds.
     */
    private fun loadProfileSettings() {
        val userId = currentUserId ?: return
        val token = bearerToken ?: return

        // Use cached settings if fresh
        if (System.currentTimeMillis() - profileSettingsLastFetchMs < PROFILE_SETTINGS_TTL_MS && profileSettings != null) {
            return
        }

        serviceScope.launch {
            try {
                val request = Request.Builder()
                    .url("$supabaseUrl/rest/v1/profiles?id=eq.$userId&select=proximity_radius_km,proximity_alerts_enabled,stealth_mode,tracking_enabled,full_name")
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("apikey", supabaseAnonKey)
                    .get()
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    val responseBody = response.body?.string()
                    if (!responseBody.isNullOrEmpty()) {
                        val jsonArray = org.json.JSONArray(responseBody)
                        if (jsonArray.length() > 0) {
                            val profile = jsonArray.getJSONObject(0)
                            val radius = profile.optDouble("proximity_radius_km", 5.0)
                            val enabled = profile.optBoolean("proximity_alerts_enabled", true)
                            currentUserName = profile.optString("full_name", null)
                            stealthMode = profile.optBoolean("stealth_mode", false)
                            trackingEnabledFromProfile = profile.optBoolean("tracking_enabled", true)

                            profileSettings = ProfileSettings(
                                proximityRadiusKm = radius,
                                proximityAlertsEnabled = enabled
                            )
                            profileSettingsLastFetchMs = System.currentTimeMillis()

                            android.util.Log.d("LocationService", "Profile loaded: radius=$radius, stealth=$stealthMode, tracking=$trackingEnabledFromProfile")
                        }
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Error loading profile settings: ${e.message}")
            }
        }
    }

    /**
     * Send location to WebView via SharedPreferences only.
     * No system-wide broadcast — GPS coordinates are too sensitive to leak.
     */
    private fun sendLocationToWebView(location: Location) {
        val prefs = getSharedPreferences("fraterna_location", Context.MODE_PRIVATE)
        prefs.edit().apply {
            putFloat("lat", location.latitude.toFloat())
            putFloat("lng", location.longitude.toFloat())
            putFloat("accuracy", location.accuracy)
            putLong("timestamp", System.currentTimeMillis())
            apply()
        }
        // Removed: sendBroadcast with GPS coords was unsecured (any app could listen).
        // WebView reads from SharedPreferences instead.
    }

    private fun sendHeartbeat() {
        val userId = currentUserId ?: run {
            android.util.Log.w("LocationService", "Skipping heartbeat: no userId")
            return
        }

        serviceScope.launch {
            try {
                val token = bearerToken ?: run {
                    android.util.Log.w("LocationService", "Skipping heartbeat: no auth token")
                    return@launch
                }

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
                } else if (response.code == 401) {
                    val errorBody = response.body?.string()?.take(200) ?: "no body"
                    android.util.Log.w("LocationService", "Got 401 on heartbeat: $errorBody")
                    // Force refresh: reset throttle, try SharedPreferences then native Supabase refresh
                    lastTokenRefreshMs = 0
                    refreshToken() // This checks SharedPreferences first, then tries Supabase refresh
                    // Retry once if token was updated
                    val retryToken = bearerToken
                    if (retryToken != null && retryToken != token) {
                        val retryRequest = Request.Builder()
                            .url("$supabaseUrl/rest/v1/profiles?id=eq.$userId")
                            .addHeader("Authorization", "Bearer $retryToken")
                            .addHeader("apikey", supabaseAnonKey)
                            .addHeader("Content-Type", "application/json")
                            .addHeader("Prefer", "return=minimal")
                            .patch(requestBody)
                            .build()
                        val retryResponse = httpClient.newCall(retryRequest).execute()
                        if (retryResponse.isSuccessful) {
                            android.util.Log.d("LocationService", "Heartbeat sent successfully (retry after 401)")
                        } else {
                            android.util.Log.e("LocationService", "Heartbeat retry failed: ${retryResponse.code}")
                        }
                    } else {
                        android.util.Log.w("LocationService", "Could not refresh token after 401, next cycle will retry")
                    }
                } else {
                    android.util.Log.e("LocationService", "Heartbeat failed: ${response.code}")
                }
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Heartbeat error: ${e.message}")
            }
        }
    }

    /**
     * Read SharedPreferences for a newer access_token than the current bearerToken.
     * Returns true if the token was updated.
     */
    private fun updateTokenFromStorage(): Boolean {
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val storedJson = prefs.getString("sb-vzlbvknauwvrqwpvtaqe-auth-token", null) ?: return false
        try {
            val tokenJson = JSONObject(storedJson)
            val storedAccessToken = tokenJson.optString("access_token", null)
            if (storedAccessToken != null && storedAccessToken != bearerToken) {
                bearerToken = storedAccessToken
                android.util.Log.d("LocationService", "Token updated from storage")
                return true
            }
        } catch (e: Exception) {
            android.util.Log.e("LocationService", "Error reading stored token: ${e.message}")
        }
        return false
    }

    /**
     * Sends the current location to Supabase.
     * CRITICAL: Respects stealth_mode and tracking_enabled — skips upload when either is off.
     */
    private fun updateLocationInSupabase(location: Location) {
        val userId = currentUserId ?: run {
            android.util.Log.w("LocationService", "Skipping location update: no userId")
            return
        }

        // Check privacy flags from both profile AND JS bridge
        if (stealthMode || !trackingEnabledFromProfile || !trackingEnabledFromJS) {
            android.util.Log.d("LocationService", "Skipping location upload: stealth=$stealthMode, trackingProfile=$trackingEnabledFromProfile, trackingJS=$trackingEnabledFromJS")
            return
        }

        serviceScope.launch {
            try {
                val token = bearerToken ?: return@launch

                // Report real accuracy with a privacy floor of 100m (no artificial ceiling)
                val accuracy = max(100, location.accuracy.toInt())
                val jsonBody = JSONObject().apply {
                    put("user_id", userId)
                    put("lat", location.latitude)
                    put("lng", location.longitude)
                    put("accuracy_meters", accuracy)
                    put("updated_at", java.time.Instant.now().toString())
                }

                val requestBody = jsonBody.toString().toRequestBody("application/json".toMediaType())

                val request = Request.Builder()
                    .url("$supabaseUrl/rest/v1/locations?on_conflict=user_id")
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("apikey", supabaseAnonKey)
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                    .post(requestBody)
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    android.util.Log.d("LocationService", "Location updated in Supabase")
                } else if (response.code == 401) {
                    val errorBody = response.body?.string()?.take(200) ?: "no body"
                    android.util.Log.w("LocationService", "Got 401 on location update: $errorBody")
                    lastTokenRefreshMs = 0
                    refreshToken()
                    val retryToken = bearerToken
                    if (retryToken != null && retryToken != token) {
                        val retryRequest = Request.Builder()
                            .url("$supabaseUrl/rest/v1/locations?on_conflict=user_id")
                            .addHeader("Authorization", "Bearer $retryToken")
                            .addHeader("apikey", supabaseAnonKey)
                            .addHeader("Content-Type", "application/json")
                            .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                            .post(requestBody)
                            .build()
                        val retryResponse = httpClient.newCall(retryRequest).execute()
                        if (retryResponse.isSuccessful) {
                            android.util.Log.d("LocationService", "Location updated in Supabase (retry after 401)")
                        } else {
                            android.util.Log.e("LocationService", "Location update retry failed: ${retryResponse.code}")
                        }
                    }
                } else {
                    android.util.Log.e("LocationService", "Location update failed: ${response.code}")
                }
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Location update error: ${e.message}")
            }
        }
    }

    /**
     * Proximity check with server-side geo filter.
     * Only fetches locations within the proximity radius instead of ALL users.
     */
    private fun checkProximityAlerts(location: Location) {
        val settings = profileSettings
        val userId = currentUserId ?: return
        val myLat = location.latitude
        val myLng = location.longitude

        // Check if alerts are disabled
        if (settings?.proximityAlertsEnabled == false) return
        val radiusKm = settings?.proximityRadiusKm ?: 5.0
        if (radiusKm <= 0) return

        serviceScope.launch {
            try {
                val token = bearerToken ?: return@launch

                // Refresh profile settings if cache is stale
                if (System.currentTimeMillis() - profileSettingsLastFetchMs > PROFILE_SETTINGS_TTL_MS) {
                    try {
                        val settingsRequest = Request.Builder()
                            .url("$supabaseUrl/rest/v1/profiles?id=eq.$userId&select=proximity_radius_km,proximity_alerts_enabled,stealth_mode,tracking_enabled")
                            .addHeader("Authorization", "Bearer $token")
                            .addHeader("apikey", supabaseAnonKey)
                            .get()
                            .build()

                        val settingsResponse = httpClient.newCall(settingsRequest).execute()
                        if (settingsResponse.isSuccessful) {
                            val settingsBody = settingsResponse.body?.string()
                            if (!settingsBody.isNullOrEmpty()) {
                                val settingsArray = org.json.JSONArray(settingsBody)
                                if (settingsArray.length() > 0) {
                                    val profileObj = settingsArray.getJSONObject(0)
                                    val alertsEnabled = profileObj.optBoolean("proximity_alerts_enabled", true)
                                    val radius = profileObj.optDouble("proximity_radius_km", 5.0)
                                    stealthMode = profileObj.optBoolean("stealth_mode", false)
                                    trackingEnabledFromProfile = profileObj.optBoolean("tracking_enabled", true)

                                    profileSettings = ProfileSettings(
                                        proximityRadiusKm = radius,
                                        proximityAlertsEnabled = alertsEnabled
                                    )
                                    profileSettingsLastFetchMs = System.currentTimeMillis()
                                }
                            }
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("LocationService", "Error refreshing profile: ${e.message}")
                    }
                }

                // Skip if alerts disabled after refresh
                if (profileSettings?.proximityAlertsEnabled == false) return@launch

                // Server-side geo filter: only fetch locations within bounding box
                val latDelta = radiusKm / 111.32 // ~degrees per km latitude
                val lngDelta = radiusKm / (111.32 * cos(Math.toRadians(myLat)))

                val minLat = myLat - latDelta
                val maxLat = myLat + latDelta
                val minLng = myLng - lngDelta
                val maxLng = myLng + lngDelta

                val nearbyUrl = "$supabaseUrl/rest/v1/locations" +
                    "?select=lat,lng,user_id,profile:profiles!locations_user_id_fkey(id,full_name,stealth_mode,tracking_enabled,last_heartbeat_at)" +
                    "&user_id=neq.$userId" +
                    "&lat=gte.$minLat&lat=lte.$maxLat" +
                    "&lng=gte.$minLng&lng=lte.$maxLng" +
                    "&lat=not.is.null&lng=not.is.null"

                val request = Request.Builder()
                    .url(nearbyUrl)
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

                            val profileObj = locationObj.optJSONObject("profile") ?: continue

                            if (profileObj.optBoolean("stealth_mode", false)) continue

                            val lastHeartbeat = profileObj.optString("last_heartbeat_at", null)
                            if (lastHeartbeat.isNullOrEmpty()) continue

                            if (!profileObj.optBoolean("tracking_enabled", true)) continue

                            // Check heartbeat is within online threshold
                            try {
                                val heartbeatTime = java.time.Instant.parse(lastHeartbeat)
                                val thresholdAgo = java.time.Instant.now().minusSeconds(ONLINE_THRESHOLD_SECONDS)
                                if (heartbeatTime.isBefore(thresholdAgo)) continue
                            } catch (e: Exception) {
                                continue
                            }

                            // Calculate distance
                            val distance = haversineDistance(myLat, myLng, lat, lng)
                            if (distance <= radiusKm) {
                                val brotherId = profileObj.optString("id", "")
                                val brotherName = profileObj.optString("full_name", "Un QH")

                                // Skip self — never notify about your own location
                                if (brotherId == currentUserId) {
                                    android.util.Log.d("LocationService", "Proximity: skipping self (brotherId=$brotherId)")
                                    continue
                                }

                                val now = System.currentTimeMillis()
                                val lastNotified = proximityCooldowns[brotherId] ?: 0L

                                if (now - lastNotified >= PROXIMITY_COOLDOWN_MS) {
                                    proximityCooldowns[brotherId] = now
                                    showProximityNotification(brotherName, distance, radiusKm)
                                    // Send push to the OTHER user telling them WE are nearby.
                                    // from_name must be OUR name, not the other user's name.
                                    val myName = currentUserName ?: "Un QH"
                                    sendProximityPushNotification(brotherId, myName)
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
        val R = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2)
        val c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

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

        notificationManager.notify(notificationIdCounter.getAndIncrement(), notification)
        android.util.Log.d("LocationService", "Proximity notification shown for $brotherName")
    }

    private fun sendProximityPushNotification(toUserId: String, fromName: String) {
        val token = bearerToken ?: return
        val myUserId = currentUserId ?: return

        serviceScope.launch(Dispatchers.IO) {
            try {
                val jsonBody = org.json.JSONObject().apply {
                    put("type", "proximity_alert")
                    put("data", org.json.JSONObject().apply {
                        put("from_user_id", myUserId)
                        put("from_name", fromName)
                        put("to_user_id", toUserId)
                    })
                }

                val request = Request.Builder()
                    .url("$supabaseUrl/functions/v1/send-push-notification")
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("apikey", supabaseAnonKey)
                    .addHeader("Content-Type", "application/json")
                    .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    android.util.Log.d("LocationService", "Proximity push sent to $toUserId")
                } else {
                    android.util.Log.e("LocationService", "Proximity push failed: ${response.code}")
                }
            } catch (e: Exception) {
                android.util.Log.e("LocationService", "Proximity push error: ${e.message}")
            }
        }
    }

    private fun scheduleRestart() {
        val currentToken = bearerToken
        val currentUserId = currentUserId
        val restartIntent = Intent(applicationContext, LocationForegroundService::class.java).apply {
            action = ACTION_START
            if (!currentToken.isNullOrEmpty()) {
                putExtra(EXTRA_AUTH_TOKEN, currentToken)
            }
            if (!currentUserId.isNullOrEmpty()) {
                putExtra(EXTRA_USER_ID, currentUserId)
            }
        }
        // Use getForegroundService() for Android 8+ (API 26+) — required to start as foreground service
        val pendingIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PendingIntent.getForegroundService(
                applicationContext,
                1,
                restartIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT
            )
        } else {
            PendingIntent.getService(
                applicationContext,
                1,
                restartIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT
            )
        }
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+: Check if we can schedule exact alarms
                if (alarmManager.canScheduleExactAlarms()) {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        System.currentTimeMillis() + 5000,
                        pendingIntent
                    )
                } else {
                    // Fall back to inexact alarm — still fires, just less precisely
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        System.currentTimeMillis() + 5000,
                        pendingIntent
                    )
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + 5000,
                    pendingIntent
                )
            } else {
                alarmManager.set(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + 5000,
                    pendingIntent
                )
            }
        } catch (e: Exception) {
            android.util.Log.e("LocationService", "Failed to schedule restart: ${e.message}")
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        android.util.Log.w("LocationService", "Task removed, scheduling restart...")
        scheduleRestart()
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        releaseWakeLock()
        serviceScope.cancel()
        locationCallback?.let {
            fusedLocationClient?.removeLocationUpdates(it)
        }
        android.util.Log.w("LocationService", "Service destroyed, scheduling restart...")
        scheduleRestart()
    }
}