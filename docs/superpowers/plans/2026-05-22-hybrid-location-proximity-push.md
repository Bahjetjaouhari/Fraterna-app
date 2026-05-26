# Hybrid Location + Server-Push Proximity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix proximity alerts in background and eliminate the persistent location arrow on iOS by switching to a hybrid location strategy + server-push for stationary user notifications.

**Architecture:** iOS switches from always-on GPS to significant-location-changes mode in background, with brief GPS windows on movement. Both platforms call the Edge Function to send push notifications to nearby stationary users. Android fixes its broken proximity notifications and increases cooldown to 5 min.

**Tech Stack:** Swift (iOS native), Kotlin (Android native), TypeScript (Supabase Edge Function), SQL (migration)

---

## Task 1: Add `proximity_alert` type to Edge Function

**Files:**
- Modify: `supabase/functions/send-push-notification/index.ts`

This task adds the server-side push notification for proximity alerts. After this task, the Edge Function can receive a `proximity_alert` type and send a push notification to the target user.

- [ ] **Step 1: Add `proximity_alert` channel mapping**

In `getChannelId()`, add a case for `proximity_alert`:

```typescript
function getChannelId(type: string): string {
  switch (type) {
    case 'emergency_message':
      return 'emergency'
    case 'global_message':
    case 'friend_request':
    case 'friend_accepted':
    case 'proximity_alert':
      return 'messages'
    default:
      return 'default'
  }
}
```

- [ ] **Step 2: Add `proximity_alert` handler before the `test` handler**

Add a new block after `friend_accepted` (before `test`), around line 436:

```typescript
    // ========================================
    // PROXIMITY ALERT - Notify a nearby QH
    // ========================================
    else if (type === 'proximity_alert') {
      const { from_user_id, from_name, to_user_id } = data

      console.log('[PROXIMITY] From:', from_user_id, 'To:', to_user_id)

      // Get recipient's push token
      const { data: recipient, error: recipientError } = await supabase
        .from('profiles')
        .select('push_token, proximity_alerts_enabled')
        .eq('id', to_user_id)
        .single()

      if (recipientError) {
        console.error('[PROXIMITY] Error fetching recipient:', recipientError)
        return new Response(JSON.stringify({ error: 'Failed to fetch recipient' }), {
          status: 500,
          headers: corsHeaders,
        })
      }

      // Skip if recipient has proximity alerts disabled
      if (recipient?.proximity_alerts_enabled === false) {
        console.log('[PROXIMITY] Recipient has proximity alerts disabled, skipping')
        return new Response(JSON.stringify({ success: true, sent: 0, skipped: true, reason: 'alerts_disabled' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (recipient?.push_token) {
        notifications.push({
          token: recipient.push_token,
          title: 'QH Cerca',
          body: `${from_name || 'Un QH'} está cerca de ti`,
          type: 'proximity_alert',
          badgeCount: 0,
          data: {
            type: 'proximity_alert',
            from_user_id: from_user_id,
            from_name: from_name || 'Un QH',
          },
        })
      } else {
        console.log('[PROXIMITY] Recipient has no push token, skipping')
      }

      console.log('[PROXIMITY] Notifications to send:', notifications.length)
    }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-push-notification/index.ts
git commit -m "feat: add proximity_alert notification type to Edge Function"
```

---

## Task 2: Add `sendProximityPushNotification` to client-side notifications library

**Files:**
- Modify: `src/lib/notifications.ts`

This adds a typed helper for calling the proximity_alert Edge Function from native code.

- [ ] **Step 1: Add `proximity_alert` to NotificationType and NotificationData**

Update the `NotificationType` union type and `NotificationData` interface:

```typescript
type NotificationType =
  | 'emergency_message'
  | 'global_message'
  | 'friend_request'
  | 'friend_accepted'
  | 'proximity_alert'
  | 'test';

interface NotificationData {
  // Emergency message
  message?: string;
  city?: string | null;

  // Friend requests
  from_user_id?: string;
  to_user_id?: string;

  // Proximity alert
  from_name?: string;

  // Test
  token?: string;
  title?: string;
  body?: string;
}
```

- [ ] **Step 2: Add `sendProximityAlertNotification` helper**

Add after `sendFriendAcceptedNotification`:

```typescript
/**
 * Send proximity alert push notification to a nearby QH
 * Called from native code when a proximity check detects a nearby user
 */
export async function sendProximityAlertNotification(
  fromUserId: string,
  fromName: string,
  toUserId: string
): Promise<{ success: boolean; sent?: number; error?: string }> {
  return sendPushNotification('proximity_alert', {
    from_user_id: fromUserId,
    from_name: fromName,
    to_user_id: toUserId,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "feat: add proximity_alert notification type and helper"
```

---

## Task 3: Modify iOS LocationManager for hybrid location strategy

**Files:**
- Modify: `ios/App/App/LocationManager.swift`

This is the core change: switch from always-on GPS to significant-location-changes in background, add 15-second GPS windows on movement, and add push notification call when proximity is detected.

- [ ] **Step 1: Change `showsBackgroundLocationIndicator` and `pausesLocationUpdatesAutomatically`**

In `init()`, around line 60-61, change:

```swift
// Before:
locationManager.showsBackgroundLocationIndicator = true
locationManager.pausesLocationUpdatesAutomatically = false

// After:
locationManager.showsBackgroundLocationIndicator = false
locationManager.pausesLocationUpdatesAutomatically = true
```

- [ ] **Step 2: Add `isGPSEnabledByMovement` property**

Add near the other properties (around line 15):

```swift
private var isGPSEnabledByMovement = false
private var gpsWindowTimer: DispatchSourceTimer?
private let gpsWindowDuration: TimeInterval = 15 // seconds to keep GPS active after movement
```

- [ ] **Step 3: Replace `appDidEnterBackground` method**

Replace the entire `appDidEnterBackground()` method (around lines 277-313) with:

```swift
@objc func appDidEnterBackground() {
    isInBackground = true
    NSLog("[LocationManager] App entered background (native)")
    sendDebugLog("app_background", details: "switching_to_significant_changes")
    if let uid = userId {
        writeImmediateDebugEvent("native_bg_v39", userId: uid)
    }

    // Stop continuous GPS — use significant location changes in background
    locationManager.stopUpdatingLocation()

    // Ensure significant location changes and visit monitoring stay active
    locationManager.startMonitoringSignificantLocationChanges()
    locationManager.startMonitoringVisits()

    // Start heartbeat timer as backup
    startHeartbeatTimer()

    // Send immediate heartbeat to maintain active status
    sendHeartbeatNow()

    NSLog("[LocationManager] Background mode: significant location changes + visits only")
}
```

- [ ] **Step 4: Replace `appDidBecomeActive` method**

Replace the entire `appDidBecomeActive()` method (around lines 315-326) with:

```swift
@objc func appDidBecomeActive() {
    isInBackground = false
    NSLog("[LocationManager] App became active (native)")
    sendDebugLog("app_foreground")

    // Restart full GPS for foreground
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.startUpdatingLocation()

    // Cancel any GPS window timer (we're in foreground now)
    cancelGPSWindowTimer()

    // Send immediate heartbeat
    sendHeartbeatNow()
}
```

- [ ] **Step 5: Add `startGPSWindowForMovement()` method**

Add after `stopBackgroundWiggleTimer()` (around line 507):

```swift
// MARK: - GPS Window for Movement Detection
// When a significant location change or visit is detected in background,
// briefly start GPS to get precise location for proximity checks and heartbeat.

private func startGPSWindowForMovement() {
    guard isInBackground else { return }

    NSLog("[LocationManager] Starting GPS window for movement detection (15s)")
    sendDebugLog("gps_window_start", details: "movement_detected")

    isGPSEnabledByMovement = true
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.startUpdatingLocation()

    // Cancel existing timer if any
    cancelGPSWindowTimer()

    // Schedule timer to stop GPS after the window duration
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now() + gpsWindowDuration, leeway: .seconds(2))
    timer.setEventHandler { [weak self] in
        guard let self = self else { return }
        self.endGPSWindow()
    }
    timer.resume()
    gpsWindowTimer = timer
}

private func endGPSWindow() {
    guard isInBackground else { return }

    NSLog("[LocationManager] Ending GPS window — switching to significant changes only")
    sendDebugLog("gps_window_end", details: "stopping_gps")
    isGPSEnabledByMovement = false
    locationManager.stopUpdatingLocation()

    // Keep significant location changes and visits active
    locationManager.startMonitoringSignificantLocationChanges()
    locationManager.startMonitoringVisits()
}

private func cancelGPSWindowTimer() {
    gpsWindowTimer?.cancel()
    gpsWindowTimer = nil
}
```

- [ ] **Step 6: Modify `locationManager(_:didUpdateLocations:)`**

In `didUpdateLocations` (around line 342), add a guard at the beginning to skip processing when in background and GPS is not in a movement window:

```swift
func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    lastKnownLocation = location

    // In background, only process location updates during GPS windows triggered by movement
    if isInBackground && !isGPSEnabledByMovement {
        // Location update from significant location changes — start GPS window
        // and process this location
        startGPSWindowForMovement()
    }

    guard let userId = userId, trackingEnabled else { return }

    // ... rest of the existing method unchanged (heartbeats, location update, proximity check)
```

This means: if we get a location update while in background and GPS isn't in a movement window, we start the GPS window and process the update. If we're in foreground or in a GPS window, we process normally.

- [ ] **Step 7: Modify `locationManager(_:didVisit:)`**

Replace the visit handler (around lines 433-453) to also start a GPS window:

```swift
func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    guard let userId = userId, trackingEnabled else { return }
    NSLog("[LocationManager] Visit detected at \(visit.coordinate), arriving: \(visit.arrivalDate), departing: \(visit.departureDate)")
    sendDebugLog("visit_detected", details: "arriving=\(visit.arrivalDate)")

    // Protect with UIBackgroundTask so iOS doesn't suspend before network completes
    var bgTaskId: UIBackgroundTaskIdentifier = .invalid
    bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "VisitHeartbeat") { [weak self] in
        self?.endBackgroundTask(bgTaskId)
    }

    // Start GPS window to get precise location for proximity check
    if isInBackground {
        startGPSWindowForMovement()
    }

    refreshTokenAsync { [weak self] in
        guard let self = self, let token = self.authToken else {
            UIApplication.shared.endBackgroundTask(bgTaskId)
            return
        }
        self.sendHeartbeat(userId: userId, authToken: token) {
            UIApplication.shared.endBackgroundTask(bgTaskId)
        }
    }
}
```

- [ ] **Step 8: Add significant location change delegate method**

Add this new method after `locationManager(_:didVisit:)`:

```swift
// MARK: - Significant Location Change Delegate
// This fires when iOS detects a significant location change (~500m or cell tower change).
// Works even when the app is terminated and can relaunch the app.

func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // Already handled above — this is here to clarify that significant location changes
    // call the same didUpdateLocations delegate method.
}

func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("[LocationManager] Location error: \(error.localizedDescription)")
    sendDebugLog("location_error", details: error.localizedDescription.prefix(80).description)
}
```

Wait — `didFailWithError` already exists. Let me add a `CLLocationManagerDelegate` method for `didEnterRegion`/`didExitRegion` is not needed since we use `startMonitoringSignificantLocationChanges` which uses `didUpdateLocations`.

Actually, `startMonitoringSignificantLocationChanges` also calls `didUpdateLocations`, so the existing handler already catches these events. The key change is in Step 6 where we start a GPS window when we get a location update in background.

- [ ] **Step 8 (revised): Remove wiggle timer references**

Remove or comment out the wiggle timer section. Specifically:
- Remove `startBackgroundWiggleTimer()` call from `appDidEnterBackground()` (already done in Step 3)
- Remove `stopBackgroundWiggleTimer()` call from `appDidBecomeActive()` (already done in Step 4)
- The `startBackgroundWiggleTimer()` and `stopBackgroundWiggleTimer()` methods can remain but will be unused — clean up later.

- [ ] **Step 9: Modify `didUpdateLocations` to also send proximity push**

In the existing `checkProximityAlerts` completion handler inside `didUpdateLocations`, after the existing `sendProximityNotification` call, add a call to the Edge Function to push to the nearby user. 

In `processProximityAlert` (around line 1024), after `sendProximityNotification(profileId:profileId, fullName: fullName, distance: distance)`, add:

```swift
// Also send push notification to the nearby user so they get notified
// even if their app is suspended in background
self.sendProximityPushNotification(toUserId: profileId, fromName: self.userId == nil ? "Un QH" : "Un QH", distance: distance)
```

- [ ] **Step 10: Add `sendProximityPushNotification` method**

Add this new method after `sendProximityNotification`:

```swift
private func sendProximityPushNotification(toUserId: String, fromName: String, distance: Double) {
    guard let authToken = authToken, let myUserId = userId else { return }

    let urlString = "\(supabaseUrl)/functions/v1/send-push-notification"
    guard let url = URL(string: urlString) else { return }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
    request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let body: [String: Any] = [
        "type": "proximity_alert",
        "data": [
            "from_user_id": myUserId,
            "from_name": fromName,
            "to_user_id": toUserId
        ]
    ]

    guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else { return }
    request.httpBody = httpBody

    URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error {
            NSLog("[LocationManager] Proximity push error: \(error.localizedDescription)")
            return
        }
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        if statusCode >= 200 && statusCode < 300 {
            NSLog("[LocationManager] ✓ Proximity push sent to \(toUserId.prefix(8))")
            self.sendDebugLog("proximity_push_sent", details: "to=\(toUserId.prefix(8))")
        } else {
            NSLog("[LocationManager] Proximity push failed: \(statusCode)")
            self.sendDebugLog("proximity_push_error", details: "status=\(statusCode)")
        }
    }.resume()
}
```

Wait — we need the sender's name, not a hardcoded "Un QH". Let me revise: the `processProximityAlert` method already has the nearby user's `full_name`, but we need the CURRENT user's name to tell the nearby user who is close. We need to store the current user's name.

- [ ] **Step 10 (revised): Add `currentUserName` property and update `sendProximityPushNotification`**

Add a property near the top:

```swift
private var currentUserName: String?
```

In `loadProfileSettings()` (around line 740), add after the existing profile field parsing:

```swift
if let name = profile["full_name"] as? String {
    self.currentUserName = name
}
```

Then the `sendProximityPushNotification` method uses `currentUserName`:

```swift
private func sendProximityPushNotification(toUserId: String, distance: Double) {
    guard let authToken = authToken, let myUserId = userId else { return }
    let fromName = currentUserName ?? "Un QH"

    let urlString = "\(supabaseUrl)/functions/v1/send-push-notification"
    guard let url = URL(string: urlString) else { return }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
    request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let body: [String: Any] = [
        "type": "proximity_alert",
        "data": [
            "from_user_id": myUserId,
            "from_name": fromName,
            "to_user_id": toUserId
        ]
    ]

    guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else { return }
    request.httpBody = httpBody

    URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error {
            NSLog("[LocationManager] Proximity push error: \(error.localizedDescription)")
            return
        }
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        if statusCode >= 200 && statusCode < 300 {
            NSLog("[LocationManager] ✓ Proximity push sent to \(toUserId.prefix(8))")
            self.sendDebugLog("proximity_push_sent", details: "to=\(toUserId.prefix(8))")
        } else {
            NSLog("[LocationManager] Proximity push failed: \(statusCode)")
            self.sendDebugLog("proximity_push_error", details: "status=\(statusCode)")
        }
    }.resume()
}
```

And update the call in `processProximityAlert`:

```swift
// Replace:
sendProximityNotification(profileId: profileId, fullName: fullName, distance: distance)

// With:
sendProximityNotification(profileId: profileId, fullName: fullName, distance: distance)
sendProximityPushNotification(toUserId: profileId, distance: distance)
```

- [ ] **Step 11: Update `setBackgroundAccuracy()` for hybrid mode**

Replace the `setBackgroundAccuracy()` method (around lines 258-272) with:

```swift
func setBackgroundAccuracy() {
    // In hybrid mode, background uses significant location changes only.
    // GPS is started briefly when movement is detected (see startGPSWindowForMovement).
    isInBackground = true
    if !isGPSEnabledByMovement {
        locationManager.stopUpdatingLocation()
        locationManager.startMonitoringSignificantLocationChanges()
        locationManager.startMonitoringVisits()
    }
}
```

- [ ] **Step 12: Update `setForegroundAccuracy()` for hybrid mode**

Replace `setForegroundAccuracy()` with:

```swift
func setForegroundAccuracy() {
    isInBackground = false
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.startUpdatingLocation()
    locationManager.startMonitoringSignificantLocationChanges()
    locationManager.startMonitoringVisits()
    cancelGPSWindowTimer()
    isGPSEnabledByMovement = false
}
```

- [ ] **Step 13: Update `locationManagerDidPauseLocationUpdates` for hybrid mode**

Replace the pause handler:

```swift
func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
    NSLog("[LocationManager] ⚠️ Location updates PAUSED by iOS")
    sendDebugLog("location_paused_restart")
    // In hybrid mode, significant location changes still work even when paused.
    // Start a GPS window in case we need proximity checks.
    if isInBackground {
        startGPSWindowForMovement()
    } else {
        manager.startUpdatingLocation()
    }
    startHeartbeatTimer()
}
```

- [ ] **Step 14: Commit iOS changes**

```bash
git add ios/App/App/LocationManager.swift
git commit -m "feat(ios): hybrid location strategy — significant changes in bg, GPS windows on movement, proximity push"
```

---

## Task 4: Update AppDelegate for hybrid mode and proximity push handling

**Files:**
- Modify: `ios/App/App/AppDelegate.swift`

- [ ] **Step 1: Update silent push handler to also check proximity**

In `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`, after the heartbeat calls, add a proximity check:

After line 219 (`LocationServicePlugin.sharedLocationManager?.sendHeartbeatNow()`), add:

```swift
// Also check proximity when woken by push — the moving user's app
// may have sent a push, so the stationary user should check their own proximity too
LocationServicePlugin.sharedLocationManager?.sendProximityCheckFromPush()
```

- [ ] **Step 2: Update BGProcessingTask to also check proximity**

In `handleHeartbeatBackgroundTask()`, after `locationManager?.sendHeartbeatNow()` and `locationManager?.setBackgroundAccuracy()`, add:

```swift
// Also check proximity in background task
locationManager?.sendProximityCheckFromPush()
```

- [ ] **Step 3: Commit**

```bash
git add ios/App/App/AppDelegate.swift
git commit -m "feat(ios): add proximity check on push wake and BGProcessingTask"
```

---

## Task 5: Add `sendProximityCheckFromPush()` to LocationPlugin bridge

**Files:**
- Modify: `ios/App/App/LocationPlugin.swift`

The AppDelegate calls `sendProximityCheckFromPush()` on the LocationManager, but we need to expose this through the shared instance.

- [ ] **Step 1: Add method to LocationManager**

In `LocationManager.swift`, add a new public method:

```swift
/// Called when the app is woken by a push notification or BGProcessingTask.
/// Uses lastKnownLocation if available, or starts a brief GPS window.
func sendProximityCheckFromPush() {
    guard let userId = userId else { return }
    if let location = lastKnownLocation {
        sendProximityCheck(location: location)
    } else if isInBackground {
        startGPSWindowForMovement()
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add ios/App/App/LocationManager.swift
git commit -m "feat(ios): add sendProximityCheckFromPush method for push-triggered proximity checks"
```

---

## Task 6: Fix Android proximity notifications

**Files:**
- Modify: `android/app/src/main/java/app/fraterna/beta/LocationForegroundService.kt`
- Modify: `android/app/src/main/java/app/fraterna/beta/MainActivity.kt`

- [ ] **Step 1: Increase proximity cooldown from 2 to 5 minutes**

In `LocationForegroundService.kt`, change line 235:

```kotlin
// Before:
private val PROXIMITY_COOLDOWN_MS = 2 * 60 * 1000L // 2 minutes

// After:
private val PROXIMITY_COOLDOWN_MS = 5 * 60 * 1000L // 5 minutes
```

- [ ] **Step 2: Add proximity push notification call in `checkProximityAlerts`**

After the `showProximityNotification` call (around line 1122), add a call to a new method:

```kotlin
if (now - lastNotified >= PROXIMITY_COOLDOWN_MS) {
    proximityCooldowns[brotherId] = now
    showProximityNotification(brotherName, distance, radiusKm)
    sendProximityPushNotification(toUserId = brotherId, fromName = currentUserName ?: "Un QH")
}
```

- [ ] **Step 3: Add `currentUserName` property and `sendProximityPushNotification` method**

Add property near other profile settings:

```kotlin
private var currentUserName: String? = null
```

In `loadProfileSettings()` (around line 800), add:

```kotlin
currentUserName = profile.optString("full_name", null)
```

Add the new method:

```kotlin
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
```

- [ ] **Step 4: Fix `MainActivity.onResume()` — don't delete proximity notification channel**

In `MainActivity.kt`, remove or comment out the `clearNonServiceNotifications()` call in `onResume()`. The current code deletes the entire notification channel which destroys pending proximity notifications.

Change:

```kotlin
override fun onResume() {
    super.onResume()
    clearNonServiceNotifications()
}
```

To:

```kotlin
override fun onResume() {
    super.onResume()
    // Don't clear proximity notifications on resume — they should persist until dismissed
    // by the user. Only clear them if they are stale (older than 10 minutes).
    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    val activeNotifications = notificationManager.activeNotifications
    for (notification in activeNotifications) {
        if (notification.id != LocationForegroundService.NOTIFICATION_ID) {
            // Keep proximity notifications — they're time-sensitive and the user should see them
        }
    }
}
```

Also update `clearNonServiceNotifications()` to not delete the channel:

```kotlin
private fun clearNonServiceNotifications() {
    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    // Cancel individual proximity notifications but don't delete the channel
    val activeNotifications = notificationManager.activeNotifications
    for (notification in activeNotifications) {
        if (notification.id != LocationForegroundService.NOTIFICATION_ID) {
            notificationManager.cancel(notification.id)
        }
    }
}
```

Wait — actually the simplest fix is to just NOT call `clearNonServiceNotifications()` in `onResume()`. The proximity notifications have `setAutoCancel(true)` so tapping them dismisses them. The channel deletion was the problem.

Change `onResume()` to:

```kotlin
override fun onResume() {
    super.onResume()
    // Don't clear proximity notifications when returning to the app.
    // They are time-sensitive and the user should see them in the notification shade.
}
```

And change `onCreate()` to not call it either:

```kotlin
override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    NotificationHelper.createNotificationChannels(this)
    registerPlugin(LocationPlugin())
    // Don't clear notifications on create — proximity alerts should persist
}
```

Actually, looking at the code more carefully, `clearNonServiceNotifications()` is called in `onCreate` AND `onResume`. It deletes the channel and recreates it. This destroys ALL pending proximity notifications. The fix is to stop calling it entirely, or change it to just cancel individual old notifications instead of deleting the channel.

The simplest fix: remove both calls to `clearNonServiceNotifications()`.

- [ ] **Step 5: Commit Android changes**

```bash
git add android/app/src/main/java/app/fraterna/beta/LocationForegroundService.kt android/app/src/main/java/app/fraterna/beta/MainActivity.kt
git commit -m "feat(android): add proximity push notification, increase cooldown to 5min, fix notification channel deletion"
```

---

## Task 7: Handle `proximity_alert` push on the JS/TS side

**Files:**
- Modify: `src/hooks/usePushNotifications.ts`
- Modify: `src/components/PushNotificationListener.tsx`

When a proximity push arrives, the app should navigate to the map view (if in foreground) or show the notification (if in background, OS handles it).

- [ ] **Step 1: Add proximity_alert handling in `usePushNotifications.ts`**

In the `pushNotificationReceived` listener (foreground), the existing code shows a toast for all notifications. Add specific handling for `proximity_alert`:

After the existing `toast(notification.title || 'New Notification', ...)` around line 126, add:

```typescript
// Handle proximity alert specifically — navigate to map if possible
if (notification.data?.type === 'proximity_alert' || notification.data?.['type'] === 'proximity_alert') {
  console.log('[PushNotifications] Proximity alert received in foreground:', notification.data);
}
```

- [ ] **Step 2: Add proximity_alert handling in `pushNotificationActionPerformed` listener**

In the tap handler (around line 132), add:

```typescript
await PushNotifications.addListener('pushNotificationActionPerformed', async (notification: ActionPerformed) => {
  console.log('Push action performed: ' + JSON.stringify(notification));

  // Navigate to map view when user taps a proximity alert
  if (notification.notification.data?.type === 'proximity_alert' ||
      notification.notification.data?.['gcm.message_type'] === 'proximity_alert') {
    console.log('[PushNotifications] Proximity alert tapped — navigating to map');
    window.dispatchEvent(new CustomEvent('fraterna:navigate-map'));
  }

  // Update badge
  if (session?.user?.id) {
    await updateBadgeToUnreadCount(session.user.id);
  }
});
```

- [ ] **Step 3: Add `proximity_alert` channel ID to Android notification channel**

In `NotificationHelper.kt` (or wherever channels are created), ensure the `messages` channel (used for proximity_alert) exists with `IMPORTANCE_HIGH`. This should already be the case, but verify.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePushNotifications.ts
git commit -m "feat: handle proximity_alert push notifications on app open"
```

---

## Task 8: Add proximity push notification handling in iOS AppDelegate

**Files:**
- Modify: `ios/App/App/AppDelegate.swift`

When a proximity push arrives while the iOS app is in background, we need to make sure the notification is displayed and the app wakes up to check proximity.

- [ ] **Step 1: Update `didReceiveRemoteNotification` to detect proximity pushes**

The existing silent push handler already wakes the app. For `proximity_alert` pushes, the notification is visible (not content-available only), so the user taps it and the app opens. No special handling needed in AppDelegate beyond what we already added in Task 4 (proximity check on push wake).

However, we should add a check to see if the push contains proximity data:

```swift
// Check if this is a proximity alert push — trigger a proximity check
if let data = userInfo["data"] as? [String: Any], data["type"] as? String == "proximity_alert" {
    NSLog("[AppDelegate] Proximity alert push received — checking for nearby QHs")
    if let locationManager = LocationServicePlugin.sharedLocationManager {
        locationManager.sendProximityCheckFromPush()
    }
}
```

Add this inside the `didReceiveRemoteNotification` method, after the heartbeat calls.

- [ ] **Step 2: Commit**

```bash
git add ios/App/App/AppDelegate.swift
git commit -m "feat(ios): handle proximity_alert push in AppDelegate"
```

---

## Task 9: Deploy Edge Function and test

**Files:**
- Deploy: `supabase/functions/send-push-notification/index.ts`

- [ ] **Step 1: Deploy the Edge Function**

```bash
cd "C:\Users\Bahje\OneDrive\Desktop\Antigravity Fraterna\Fraterna Lovable"
npx supabase functions deploy send-push-notification --project-ref vzlbvknauwvrqwpvtaqe
```

Or use the Supabase MCP tool to deploy.

- [ ] **Step 2: Test the proximity_alert endpoint**

Using curl or the MCP tool, send a test proximity alert:

```bash
curl -X POST https://vzlbvknauwvrqwpvtaqe.supabase.co/functions/v1/send-push-notification \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"type":"proximity_alert","data":{"from_user_id":"9fbbb75e-3241-44e5-a894-3cee933fb61e","from_name":"Bahjet","to_user_id":"b97c6b12-1d91-4195-b8df-7a44aef8e7be"}}'
```

Verify the response includes `success: true` and the push is sent.

- [ ] **Step 3: Commit deployment**

```bash
git add -A
git commit -m "chore: deploy proximity_alert Edge Function"
```

---

## Task 10: Update JS-side proximity toast cooldown to 5 minutes

**Files:**
- Modify: `src/pages/MapView.tsx`

The web frontend has its own 2-minute cooldown for proximity toasts. This should match the native 5-minute cooldown.

- [ ] **Step 1: Change cooldown from 2 to 5 minutes**

In `MapView.tsx`, find the line:

```typescript
const COOLDOWN_MS = 2 * 60 * 1000; // 2-minute cooldown per user
```

Change to:

```typescript
const COOLDOWN_MS = 5 * 60 * 1000; // 5-minute cooldown per user
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/MapView.tsx
git commit -m "fix: increase proximity alert cooldown to 5 minutes (match native)"
```

---

## Task 11: Update iOS build number and test

**Files:**
- Modify: `ios/App/App.xcodeproj/project.pbxproj` (build number)

- [ ] **Step 1: Increment iOS build number to 46**

Update `CURRENT_PROJECT_VERSION` from 45 to 46 in the project.pbxproj.

- [ ] **Step 2: Increment Android versionCode to 53 and versionName to 3.26**

In `android/app/build.gradle`, update:
```groovy
versionCode 53
versionName "3.26"
```

- [ ] **Step 3: Final commit**

```bash
git add ios/App/App.xcodeproj/project.pbxproj android/app/build.gradle
git commit -m "chore: bump version numbers for hybrid location + proximity push release"
```

---

## Task 12: Verify and debug

- [ ] **Step 1: Test iOS hybrid mode**
  - Build and run on iOS device
  - Put app in background — verify location arrow disappears (or appears briefly then goes away)
  - Walk ~500m — verify location arrow appears briefly, heartbeat continues, proximity check fires
  - Verify debug_log shows `gps_window_start`, `gps_window_end`, `significant_location` events

- [ ] **Step 2: Test proximity push notifications**
  - Two devices: one iOS, one Android
  - Put one device in background at a location
  - Move the other device within proximity radius
  - Verify the background device receives a "QH Cerca" push notification
  - Verify the moving device shows a local notification AND sends a push

- [ ] **Step 3: Test active status**
  - Put iOS device in background (stationary)
  - Verify heartbeats continue via silent push (check `last_heartbeat_at` in Supabase)
  - Verify user shows as "active" on the map

- [ ] **Step 4: Verify debug_log in Supabase**
  - Check for `proximity_push_sent` events from iOS
  - Check for `gps_window_start` and `gps_window_end` events
  - Check for `proximity_results` events showing nearby users
  - Verify no `proximity_error` or `proximity_http_error` events