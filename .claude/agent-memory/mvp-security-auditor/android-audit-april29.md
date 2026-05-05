---
name: Android Location Service Audit 29 Apr 2026
description: Complete audit of Android background location tracking - 5 CRITICAL, 9 HIGH, 9 MEDIUM, 4 LOW findings
type: project
---

Android background location tracking audit completed 2026-04-29. Verdict: NOT PRODUCTION READY.

## CRITICAL findings (must fix before launch)
1. Supabase anon key hardcoded in LocationForegroundService.kt:84
2. Proximity check fetches ALL user locations every 15s (no bounding box) - line 618
3. Unsecured broadcast Intent with GPS coordinates (app.fraterna.beta.LOCATION_UPDATE) - line 454
4. No stealth_mode/tracking_enabled gate on location upload - updateLocationInSupabase ignores it - line 512
5. OkHttpClient has no timeout config (default 10s can block coroutines) - line 68

## HIGH findings
6. BootReceiver fails silently on Android 12+ (ForegroundServiceStartNotAllowedException) - BootReceiver.kt:26
7. Unbounded session load retry loop with no max attempts - line 233
8. refreshToken() called 3x per location update (wasteful) - line 286
9. Profile settings fetched via HTTP every 15s (redundant) - line 576
10. profileSettings not @Volatile (cross-thread visibility) - line 86
11. proximityCooldowns HashMap not thread-safe (ConcurrentModificationException risk) - line 79
12. notificationIdCounter not atomic - line 704
13. cancelAll() in MainActivity kills foreground service notification (Android 13+ race) - MainActivity.kt:63
14. WakeLock acquired with no timeout (battery drain if leaked) - line 204

## MEDIUM findings
15. No WorkManager fallback for service restart after force-stop
16. minifyEnabled false in release build (easy decompilation)
17. Location accuracy coerced to fake 100-300m range
18. JS/native bridge parameter mismatch (startLocationUpdates vs startLocationService)
19. setForegroundAccuracy/setBackgroundAccuracy not implemented on Android
20. Online status logic duplicated (should use is_user_active SQL function)
21. FCM token sent as unsecured broadcast
22. SCHEDULE_EXACT_ALARM may need user grant on Android 13+
23. BootReceiver does not check token expiry before starting service

## Key architectural notes
- Service uses START_STICKY + AlarmManager restart (onTaskRemoved, onDestroy) - no WorkManager
- Token refresh is self-managed via Supabase REST endpoint (not JS SDK)
- Location updates: FusedLocationProvider, 15s interval, HIGH_ACCURACY, MainLooper
- Proximity: fetches ALL locations then client-side Haversine (no server-side filter)
- No stealth_mode integration in Android native code at all