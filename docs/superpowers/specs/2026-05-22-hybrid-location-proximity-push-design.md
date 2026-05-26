# Hybrid Location Strategy + Server-Push Proximity Alerts

**Date:** 2026-05-22
**Status:** Approved

## Problem Statement

1. **iOS location arrow always visible** — `startUpdatingLocation()` with `showsBackgroundLocationIndicator = true` keeps GPS active 24/7, showing the persistent blue location arrow and draining battery.

2. **Proximity alerts don't work in background** — On iOS, `checkProximityAlerts` produces zero debug_log events. On Android, proximity notifications used to work but no longer do. Both platforms only show proximity banners when the app is foregrounded.

3. **Stationary user must be notified** — When a QH enters a stationary user's radius, the stationary user must receive a notification even though their app is suspended.

## Design

### 1. iOS Location Strategy: Hybrid Mode

**Current behavior (remove):**
- `startUpdatingLocation()` always on in background
- `showsBackgroundLocationIndicator = true`
- `pausesLocationUpdatesAutomatically = false`
- Wiggle timer restarts GPS every 3 min
- Heartbeat via GPS callback + wiggle timer

**New behavior:**

| State | Location API | Heartbeat | Proximity Check |
|-------|-------------|-----------|-----------------|
| Foreground | `startUpdatingLocation()` (GPS) | Via `didUpdateLocations` | Via `didUpdateLocations` |
| Background (moving) | `startUpdatingLocation()` for 15s after significant change | Via silent push (keepalive-push cron) | During 15s GPS window + on push wake |
| Background (stationary) | `startMonitoringSignificantLocationChanges()` + `startMonitoringVisits()` only | Via silent push | Via push from other user's app |

**Key changes to LocationManager.swift:**
- `showsBackgroundLocationIndicator = false`
- `pausesLocationUpdatesAutomatically = true`
- On `appDidEnterBackground`: stop `startUpdatingLocation()`, keep `startMonitoringSignificantLocationChanges()` + `startMonitoringVisits()`
- On `appDidBecomeActive`: restart `startUpdatingLocation()`
- On `locationManager(_:didUpdateLocations:)`: only process when foreground OR during 15s GPS window
- On `locationManager(_:didVisit:)`: send heartbeat, start 15s GPS window for proximity check
- On significant location change delegate: send heartbeat, start 15s GPS window for proximity check
- Remove wiggle timer (no longer needed)
- Keep heartbeat timer as backup (fires when app is awake)

**Active status guarantee:**
- Silent push notifications (keepalive-push cron, every 2 min) wake the app → send heartbeat → update `last_heartbeat_at`
- User stays "active" as long as: tracking=ON, stealth=OFF, session=open, phone=on
- BGProcessingTask as additional backup (every 15 min)

### 2. Proximity Alerts: Native Check + Server Push

**Current behavior (modify):**
- Native code checks proximity, shows local notification on own device only
- Stationary users never get notified (app suspended, no GPS callback)

**New behavior:**

When a user's native proximity check detects a nearby QH:
1. Show local notification on own device (keep current behavior)
2. **NEW**: Call `send-push-notification` Edge Function with type `proximity_alert` to send a push notification to the nearby QH's device

**Flow:**
```
User A moves → A's app detects B is within radius
  → A sees local notification "Miguel está a 400m"
  → A's app calls Edge Function → B receives push "QH Cerca: Bahjet está cerca"
  → B taps notification → B's app opens → B sees A on map
```

**Push notification payload (data only, distance not shown for privacy):**
```json
{
  "type": "proximity_alert",
  "from_user_id": "<sender_id>",
  "from_name": "Bahjet"
}
```

### 3. Edge Function Changes: `send-push-notification`

Add `proximity_alert` type support:

- **Title**: "QH Cerca"
- **Body**: "{from_name} está cerca de ti" (distance not included in push for privacy)
- **Data**: `{ type: "proximity_alert", from_user_id, from_name }`
- **Target**: Look up `push_token` from `profiles` table for the nearby user
- **Cooldown**: Server-side check — don't send if a proximity notification was sent to this user pair in the last 5 minutes (use `notification_queue` table or Redis)

### 4. Android Changes

- Increase `PROXIMITY_COOLDOWN_MS` from 2 min to 5 min (match iOS)
- Remove `deleteNotificationChannel(CHANNEL_ID_PROXIMITY)` from `MainActivity.onResume()` — this destroys pending notifications
- Add call to `send-push-notification` Edge Function when proximity is detected (same as iOS)
- Keep foreground service architecture unchanged

### 5. User Status Logic (unchanged requirement)

A user is **active** when ALL of:
- `tracking_enabled = true`
- `stealth_mode = false`
- Session is open (logged in)
- Phone is on

A user is **inactive** when ANY of:
- `tracking_enabled = false`
- `stealth_mode = true`
- Session closed (logged out)
- Phone off

Heartbeats (`last_heartbeat_at` updates) maintain active status. The hybrid mode still sends heartbeats via silent push, so active status is preserved.

## Files to Modify

### iOS
- `ios/App/App/LocationManager.swift` — Hybrid mode, remove wiggle timer, add 15s GPS window, add push notification call
- `ios/App/App/AppDelegate.swift` — Update silent push handler for proximity push reception

### Android
- `android/app/src/main/java/app/fraterna/beta/LocationForegroundService.kt` — Add push call, increase cooldown
- `android/app/src/main/java/app/fraterna/beta/MainActivity.kt` — Remove notification channel deletion on resume

### Server
- `supabase/functions/send-push-notification/index.ts` — Add `proximity_alert` type
- `supabase/migrations/` — Add cooldown tracking for proximity notifications

### Shared
- `src/hooks/usePushNotifications.ts` or `src/components/PushNotificationListener.tsx` — Handle `proximity_alert` push type on app open

## Cooldown Strategy

- **Native-side**: Per-user cooldown of 5 minutes (already exists, increase Android from 2→5 min)
- **Server-side**: Prevent duplicate push notifications for the same user pair within 5 minutes. Use `notification_queue` table with `type`, `data->from_user_id`, and `created_at` to check recent sends before sending a new push.

## Edge Cases

1. **Both users stationary**: Neither app is checking proximity. No notification sent. Acceptable — if neither moved, they were already notified when they first came close.
2. **App terminated on receiving device**: APNS/FCM delivers the push notification to the OS, which shows it. Tapping the notification relaunches the app.
3. **No push token**: If the target user has no `push_token` in their profile, the push silently fails. The `send-push-notification` function should handle this gracefully.
4. **User turns off proximity alerts**: `proximity_alerts_enabled = false` in profiles — native check skips, push not sent.
5. **Stealth mode**: If sender or receiver has `stealth_mode = true`, proximity check skips both locally and in push.