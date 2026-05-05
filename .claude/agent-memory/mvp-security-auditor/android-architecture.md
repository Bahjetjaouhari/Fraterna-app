---
name: Android Architecture Summary
description: Key architectural patterns in Fraterna Android native code for future audit reference
type: project
---

## Android Native Architecture (as of 2026-04-29)

- **Target SDK**: 36, minSdk 24, compileSdk 36
- **Package**: app.fraterna.beta (versionCode 40, v3.16)
- **Location Service**: `LocationForegroundService` - standalone foreground service with `START_STICKY`, `FOREGROUND_SERVICE_TYPE_LOCATION`
- **Location Provider**: FusedLocationProviderClient, 15s interval, PRIORITY_HIGH_ACCURACY, callbacks on MainLooper
- **Boot Recovery**: `BootReceiver` for `BOOT_COMPLETED` - starts service after reboot (fails on Android 12+ from background)
- **Crash Recovery**: AlarmManager `setExactAndAllowWhileIdle` in `onTaskRemoved`/`onDestroy` (5s delay restart)
- **No WorkManager**: All restart logic uses AlarmManager; no WorkManager safety net
- **Token Management**: Self-managed via Supabase REST `/auth/v1/token?grant_type=refresh_token` - reads from/writes to CapacitorStorage SharedPreferences
- **HTTP Client**: OkHttp4 (no timeout config, default 10s)
- **Bridge**: Capacitor plugin `LocationPlugin` registered in `MainActivity` - methods: `startLocationService`, `stopLocationService`, `isServiceRunning`, `getLastKnownLocation`
- **Missing bridge methods**: `setTrackingEnabled`, `setForegroundAccuracy`, `setBackgroundAccuracy` (called from JS but not implemented in Android)
- **Proximity**: Fetches ALL locations from Supabase every 15s, client-side Haversine filter (no server-side geo filter)
- **Notification channels**: 5 total (default, messages, emergency in NotificationHelper; location + proximity in LocationForegroundService)