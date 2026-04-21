# Online Status + Background Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix online status detection to be accurate (heartbeat timeout + tracking_enabled) and add native iOS background location service with heartbeat, achieving parity with Android.

**Architecture:** Unified "online" definition using `last_heartbeat_at` within 3 min + `tracking_enabled = true`. iOS gets a native `LocationManager` service that sends heartbeats and location updates in background, matching Android's `LocationForegroundService`. App lifecycle switches from web `visibilitychange` to `@capacitor/app` native events. Dead `is_online` column and `is_user_online()` function are removed.

**Tech Stack:** Swift (iOS native), Kotlin (Android native), TypeScript/React (frontend), SQL (Supabase migrations), Capacitor plugins

---

### Task 1: Database Migration - Fix Online Status Functions

**Files:**
- Create: `supabase/migrations/20260420000000_fix_online_status.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Drop unused is_online column
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_online;

-- Drop index for is_online
DROP INDEX IF EXISTS profiles_is_online_idx;

-- Drop old is_user_online function (replaced by is_user_active)
DROP FUNCTION IF EXISTS is_user_online(UUID);

-- Update is_user_active to include 3-min heartbeat timeout + tracking_enabled check
CREATE OR REPLACE FUNCTION is_user_active(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = uid
    AND last_heartbeat_at > NOW() - INTERVAL '3 minutes'
    AND tracking_enabled = true
  );
$$ LANGUAGE sql STABLE;

-- Update get_online_users to use same logic (3 min + tracking_enabled)
CREATE OR REPLACE FUNCTION get_online_users()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '3 minutes'
    AND tracking_enabled = true
    AND stealth_mode = false;
END;
$$ LANGUAGE plpgsql STABLE;
```

- [ ] **Step 2: Run the migration locally**

Run: `npx supabase db push` or apply via Supabase dashboard.

- [ ] **Step 3: Verify migration applied**

Check in Supabase dashboard that `is_online` column is gone, `is_user_online` function is gone, `is_user_active` returns correct results for active/inactive users.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260420000000_fix_online_status.sql
git commit -m "feat: unify online status - drop is_online, update is_user_active with 3-min timeout"
```

---

### Task 2: Shared isUserOnline Utility Function

**Files:**
- Create: `src/utils/userStatus.ts`

- [ ] **Step 1: Create the shared utility**

```typescript
export interface UserStatusProfile {
  last_heartbeat_at: string | null;
  tracking_enabled: boolean | null;
}

const THREE_MINUTES_MS = 3 * 60 * 1000;

export function isUserOnline(profile: UserStatusProfile): boolean {
  if (!profile.last_heartbeat_at) return false;
  if (profile.tracking_enabled === false) return false;
  const threeMinAgo = Date.now() - THREE_MINUTES_MS;
  return new Date(profile.last_heartbeat_at).getTime() > threeMinAgo;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/userStatus.ts
git commit -m "feat: add shared isUserOnline utility with 3-min timeout + tracking check"
```

---

### Task 3: Update MapView to Use Shared isUserOnline

**Files:**
- Modify: `src/pages/MapView.tsx`

- [ ] **Step 1: Replace inline isUserOnline with shared utility**

In `MapView.tsx`:
1. Add import at top: `import { isUserOnline } from '@/utils/userStatus';`
2. Remove the local `isUserOnline` function (lines 62-67):
   ```typescript
   // DELETE this function:
   const isUserOnline = (lastHeartbeat: string | null | undefined): boolean => {
     return lastHeartbeat != null;
   };
   ```
3. Find all usages of `isUserOnline(b.profile?.last_heartbeat_at)` and replace with `isUserOnline(b.profile)` — the function now takes a profile object with `last_heartbeat_at` and `tracking_enabled`.
4. The `isActive` determination (around line 710) currently is:
   ```typescript
   const isActive = isUserOnline(b.profile?.last_heartbeat_at) && b.profile?.tracking_enabled !== false && b.profile?.stealth_mode !== true;
   ```
   Replace with:
   ```typescript
   const isActive = isUserOnline(b.profile) && b.profile?.stealth_mode !== true;
   ```
   (The `tracking_enabled` check is now inside `isUserOnline`.)

- [ ] **Step 2: Verify MapView renders correctly**

Run the dev server, navigate to the map, confirm markers show green/red correctly based on heartbeat age and tracking status.

- [ ] **Step 3: Commit**

```bash
git add src/pages/MapView.tsx
git commit -m "refactor: MapView uses shared isUserOnline with 3-min timeout"
```

---

### Task 4: Update Chat Active Users Count

**Files:**
- Modify: `src/pages/Chat.tsx`

- [ ] **Step 1: Replace last_seen_at query with is_user_active RPC**

In `Chat.tsx`, find the `fetchActiveUsers` function (around lines 157-172) that queries `profiles` with `gte("last_seen_at", fiveMinAgo)` and replace it:

```typescript
const fetchActiveUsers = async () => {
  const { count, error } = await supabase
    .rpc('get_online_users_count');

  if (!error && count !== null) setActiveUsersCount(count);
};
```

- [ ] **Step 2: Add get_online_users_count SQL function**

Add to the migration file from Task 1:

```sql
-- Convenience function to count online users
CREATE OR REPLACE FUNCTION get_online_users_count()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '3 minutes'
    AND tracking_enabled = true;
$$ LANGUAGE sql STABLE;
```

If the migration was already applied, create a new migration file `supabase/migrations/20260420000001_add_online_users_count.sql`.

- [ ] **Step 3: Verify Chat shows correct active user count**

Run the dev server, open Chat, confirm the "activos" count shows correctly.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Chat.tsx supabase/migrations/
git commit -m "refactor: Chat uses get_online_users_count RPC instead of last_seen_at"
```

---

### Task 5: Update EmergencyChat Active Users Count

**Files:**
- Modify: `src/pages/EmergencyChat.tsx`

- [ ] **Step 1: Replace last_seen_at query with is_user_active RPC by city**

In `EmergencyChat.tsx`, find the `fetchActiveUsers` function (around lines 124-136) and replace it:

```typescript
const fetchActiveUsers = async () => {
  if (!myCity) {
    setActiveUsersCount(0);
    return;
  }
  const { count, error } = await supabase
    .rpc('get_online_users_count_by_city', { city_param: myCity });

  if (!error && count != null) setActiveUsersCount(count);
};
```

- [ ] **Step 2: Add get_online_users_count_by_city SQL function**

Add to migration:

```sql
CREATE OR REPLACE FUNCTION get_online_users_count_by_city(city_param TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '3 minutes'
    AND tracking_enabled = true
    AND city ILIKE city_param;
$$ LANGUAGE sql STABLE;
```

- [ ] **Step 3: Verify EmergencyChat shows correct active user count**

Run dev server, open EmergencyChat, confirm the "activos" count shows correctly filtered by city.

- [ ] **Step 4: Commit**

```bash
git add src/pages/EmergencyChat.tsx supabase/migrations/
git commit -m "refactor: EmergencyChat uses get_online_users_count_by_city RPC"
```

---

### Task 6: Update Android LocationForegroundService isUserOnline Logic

**Files:**
- Modify: `android/app/src/main/java/app/fraterna/beta/LocationForegroundService.kt`

- [ ] **Step 1: Update isUserOnline check in checkProximityAlerts**

Find the proximity check in `checkProximityAlerts` (around lines 400-406) where it currently does:

```kotlin
val lastHeartbeat = profileObj.optString("last_heartbeat_at", null)
if (lastHeartbeat.isNullOrEmpty()) {
    // Skip user with no heartbeat (not logged in)
    continue
}
```

Replace with a time-based check:

```kotlin
val lastHeartbeat = profileObj.optString("last_heartbeat_at", null)
if (lastHeartbeat.isNullOrEmpty()) {
    continue  // No heartbeat = not logged in
}

// Check if heartbeat is within 3 minutes
val trackingEnabled = profileObj.optBoolean("tracking_enabled", true)
if (!trackingEnabled) {
    continue  // Tracking disabled = offline
}

val heartbeatTime = java.time.Instant.parse(lastHeartbeat)
val threeMinAgo = java.time.Instant.now().minusSeconds(180)
if (heartbeatTime.isBefore(threeMinAgo)) {
    continue  // Heartbeat too old = no internet or app closed
}
```

- [ ] **Step 2: Ensure query fetches tracking_enabled field**

Find the Supabase REST query in `checkProximityAlerts` that fetches profile data and ensure it includes `tracking_enabled` in the select. The query should request `last_heartbeat_at,tracking_enabled,stealth_mode,proximity_alerts_enabled,proximity_radius_km` (add `tracking_enabled` if missing).

- [ ] **Step 3: Build and test Android**

```bash
cd android && ./gradlew assembleDebug
```

Verify the build succeeds.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/app/fraterna/beta/LocationForegroundService.kt
git commit -m "fix: Android proximity check uses 3-min heartbeat timeout + tracking_enabled"
```

---

### Task 7: Create iOS LocationManager Native Service

**Files:**
- Create: `ios/App/App/LocationManager.swift`

- [ ] **Step 1: Create LocationManager.swift**

```swift
import Foundation
import CoreLocation
import UserNotifications

@objc(LocationManager)
class LocationManager: NSObject, CLLocationManagerDelegate {
    private let locationManager = CLLocationManager()
    private let supabaseUrl: String
    private let supabaseAnonKey: String
    private var userId: String?
    private var authToken: String?
    private var proximityCooldowns: [String: Date] = [:]
    private var trackingEnabled: Bool = true
    private var proximityRadiusKm: Double = 1.0
    private var proximityAlertsEnabled: Bool = true

    override init() {
        // Read config from Info.plist
        guard let url = Bundle.main.object(forInfoDictionaryKey: "SupabaseUrl") as? String,
              let key = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String else {
            supabaseUrl = ""
            supabaseAnonKey = ""
            super.init()
            return
        }
        supabaseUrl = url
        supabaseAnonKey = key
        super.init()
    }

    func startLocationUpdates(userId: String, authToken: String) {
        self.userId = userId
        self.authToken = authToken

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.pausesLocationUpdatesAutomatically = true
        locationManager.activityType = .automotive
        locationManager.distanceFilter = 10.0

        locationManager.requestAlwaysAuthorization()
        locationManager.startUpdatingLocation()

        // Register for significant location changes as fallback
        locationManager.startMonitoringSignificantLocationChanges()
    }

    func stopLocationUpdates() {
        locationManager.stopUpdatingLocation()
        locationManager.stopMonitoringSignificantLocationChanges()
        userId = nil
        authToken = nil
    }

    func setTrackingEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
        if enabled {
            locationManager.startUpdatingLocation()
            locationManager.startMonitoringSignificantLocationChanges()
        } else {
            locationManager.stopUpdatingLocation()
            locationManager.stopMonitoringSignificantLocationChanges()
            // Clear heartbeat to mark offline
            clearHeartbeat()
        }
    }

    func setForegroundAccuracy() {
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 10.0
    }

    func setBackgroundAccuracy() {
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = 50.0
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last,
              let userId = userId,
              let authToken = authToken,
              trackingEnabled else { return }

        sendHeartbeat(userId: userId, authToken: authToken)
        updateLocation(userId: userId, authToken: authToken, location: location)
        checkProximityAlerts(userId: userId, authToken: authToken, location: location)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[LocationManager] Location error: \(error.localizedDescription)")
    }

    // MARK: - Heartbeat

    private func sendHeartbeat(userId: String, authToken: String) {
        let url = URL(string: "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let body: [String: Any] = ["last_heartbeat_at": ISO8601DateFormatter().string(from: Date())]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request).resume()
    }

    private func clearHeartbeat() {
        guard let userId = userId, let authToken = authToken else { return }
        let url = URL(string: "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let body: [String: Any] = ["last_heartbeat_at": NSNull()]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request).resume()
    }

    // MARK: - Location Update

    private func updateLocation(userId: String, authToken: String, location: CLLocation) {
        let url = URL(string: "\(supabaseUrl)/rest/v1/profiles?id=eq.\(userId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        let body: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request).resume()
    }

    // MARK: - Proximity Alerts

    private func checkProximityAlerts(userId: String, authToken: String, location: CLLocation) {
        guard proximityAlertsEnabled else { return }

        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let radius = proximityRadiusKm * 0.01 // approximate degrees

        let urlString = "\(supabaseUrl)/rest/v1/profiles?select=id,last_heartbeat_at,tracking_enabled,stealth_mode,proximity_alerts_enabled,proximity_radius_km,latitude,longitude&latitude=not.is.null&longitude=not.is.null&id=neq.\(userId)&latitude=gt.\(lat - radius)&latitude=lt.\(lat + radius)&longitude=gt.\(lng - radius)&longitude=lt.\(lng + radius)"

        guard let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        request.setValue("bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self, let data = data, error == nil else { return }

            do {
                guard let profiles = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
                for profile in profiles {
                    self.processProximityAlert(userId: userId, profile: profile, myLocation: location)
                }
            } catch {
                print("[LocationManager] Proximity parse error: \(error)")
            }
        }.resume()
    }

    private func processProximityAlert(userId: String, profile: [String: Any], myLocation: CLLocation) {
        guard let profileId = profile["id"] as? String,
              let trackingEnabled = profile["tracking_enabled"] as? Bool, trackingEnabled,
              let stealthMode = profile["stealth_mode"] as? Bool, !stealthMode,
              let lastHeartbeat = profile["last_heartbeat_at"] as? String else { return }

        // Check heartbeat is within 3 minutes
        let formatter = ISO8601DateFormatter()
        guard let heartbeatDate = formatter.date(from: lastHeartbeat) else { return }
        let threeMinAgo = Date().addingTimeInterval(-180)
        guard heartbeatDate > threeMinAgo else { return }

        // Check distance
        guard let lat = profile["latitude"] as? Double,
              let lng = profile["longitude"] as? Double else { return }
        let theirLocation = CLLocation(latitude: lat, longitude: lng)
        let distance = myLocation.distance(from: theirLocation) / 1000.0 // km

        let theirRadius = profile["proximity_radius_km"] as? Double ?? 1.0
        let myRadius = proximityRadiusKm
        let alertRadius = min(myRadius, theirRadius)

        guard distance <= alertRadius else { return }

        // Check cooldown (2 minutes per user)
        if let lastAlert = proximityCooldowns[profileId],
           Date().timeIntervalSince(lastAlert) < 120 { return }

        proximityCooldowns[profileId] = Date()
        sendProximityNotification(profileId: profileId, distance: distance)
    }

    private func sendProximityNotification(profileId: String, distance: Double) {
        let content = UNMutableNotificationContent()
        content.title = "QH Cerca"
        content.body = String(format: "Un QH hermano está a %.1f km de ti", distance)
        content.sound = .default
        content.categoryIdentifier = "proximity"

        let request = UNNotificationRequest(identifier: "proximity-\(profileId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
```

- [ ] **Step 2: Add Supabase config to Info.plist**

Add these entries to `ios/App/App/Info.plist` inside the top-level `<dict>`:

```xml
<key>SupabaseUrl</key>
<string>YOUR_SUPABASE_URL</string>
<key>SupabaseAnonKey</key>
<string>YOUR_SUPABASE_ANON_KEY</string>
```

Replace with actual values from the project's `.env` or `supabase.ts` config.

- [ ] **Step 3: Commit**

```bash
git add ios/App/App/LocationManager.swift ios/App/App/Info.plist
git commit -m "feat: add iOS native LocationManager with background location, heartbeat, proximity alerts"
```

---

### Task 8: Create iOS LocationPlugin Capacitor Bridge

**Files:**
- Create: `ios/App/App/LocationPlugin.swift`
- Modify: `ios/App/App/AppDelegate.swift`
- Modify: `ios/App/App/App.swift` (or the main app entry point)

- [ ] **Step 1: Create LocationPlugin.swift**

```swift
import Foundation
import Capacitor

@objc(LocationPlugin)
public class LocationPlugin: CAPPlugin {
    private let locationManager = LocationManager()

    @objc func startLocationUpdates(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"),
              let authToken = call.getString("authToken") else {
            call.reject("Missing userId or authToken")
            return
        }
        locationManager.startLocationUpdates(userId: userId, authToken: authToken)
        call.resolve()
    }

    @objc func stopLocationUpdates(_ call: CAPPluginCall) {
        locationManager.stopLocationUpdates()
        call.resolve()
    }

    @objc func setTrackingEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Missing enabled parameter")
            return
        }
        locationManager.setTrackingEnabled(enabled)
        call.resolve()
    }

    @objc func setForegroundAccuracy(_ call: CAPPluginCall) {
        locationManager.setForegroundAccuracy()
        call.resolve()
    }

    @objc func setBackgroundAccuracy(_ call: CAPPluginCall) {
        locationManager.setBackgroundAccuracy()
        call.resolve()
    }

    @objc override public func load() {
        // Called when plugin is loaded by Capacitor
    }
}
```

- [ ] **Step 2: Register plugin in AppDelegate.swift**

In `AppDelegate.swift`, inside the `application(_:didFinishLaunchingWithOptions:)` method, add before `return true`:

```swift
// Register LocationPlugin
let locationPlugin = LocationPlugin()
locationPlugin.load()
```

- [ ] **Step 3: Register plugin in Capacitor config**

Add the plugin to the Capacitor plugin registry. In `ios/App/App/App/App-Bridging-Header.h` or create a `CAPPluginRegister.m` file if needed. The standard Capacitor approach is to add the plugin to `capacitor.config.ts`:

Check the current `capacitor.config.ts` for the plugins section and add the LocationPlugin registration following the pattern used by other custom plugins in the project (e.g., LocationPlugin for Android).

- [ ] **Step 4: Commit**

```bash
git add ios/App/App/LocationPlugin.swift ios/App/App/AppDelegate.swift ios/App/App/
git commit -m "feat: add Capacitor bridge for iOS LocationPlugin"
```

---

### Task 9: Install @capacitor/app and Update App Lifecycle

**Files:**
- Modify: `src/hooks/useAuth.tsx`

- [ ] **Step 1: Install @capacitor/app**

```bash
npm install @capacitor/app
npx cap sync
```

- [ ] **Step 2: Replace visibilitychange/pageshow with @capacitor/app in useAuth.tsx**

Find and remove the `visibilitychange` event listener (around lines 233-241):

```typescript
// DELETE this block:
const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible' && user?.id) {
    sendHeartbeat(user.id);
  }
  // NOTE: We do NOT stop heartbeat when hidden because:
  // - The foreground service keeps location updating
  // - User should stay active even when app is in background
};
```

Find and remove the `pageshow` event listener (around lines 244-256).

Remove the event listener registrations:
```typescript
// DELETE these lines:
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('pageshow', handlePageShow);
// And their cleanup:
document.removeEventListener('visibilitychange', handleVisibilityChange);
window.removeEventListener('pageshow', handlePageShow);
```

Add `@capacitor/app` import at top of file:
```typescript
import { App } from '@capacitor/app';
```

Add the `appStateChange` listener in the same place where the removed listeners were:

```typescript
useEffect(() => {
  const handleAppStateChange = async (state: { isActive: boolean }) => {
    if (state.isActive && user?.id) {
      // App came to foreground
      sendHeartbeat(user.id);
      // Refresh data on resume
      refreshOnResume?.();
    }
  };

  const subscription = App.addListener('appStateChange', handleAppStateChange);
  return () => {
    subscription.then(s => s.remove());
  };
}, [user?.id]);
```

Add a `refreshOnResume` callback prop or internal function that refetches key data:

```typescript
const refreshOnResume = useCallback(async () => {
  // Trigger data refresh events that other hooks can listen to
  // This will cause MapView, Chat, EmergencyChat to re-fetch their data
  window.dispatchEvent(new CustomEvent('app-resume'));
}, []);
```

- [ ] **Step 3: Add resume listeners in key components**

In `MapView.tsx`, add a listener for the `app-resume` event that re-fetches brothers data:

```typescript
useEffect(() => {
  const handleResume = () => {
    // Re-fetch brothers locations
    fetchBrothers();
  };
  window.addEventListener('app-resume', handleResume);
  return () => window.removeEventListener('app-resume', handleResume);
}, []);
```

In `Chat.tsx`, add a similar listener to re-fetch messages.

In `EmergencyChat.tsx`, add a similar listener.

In `useUnreadCount.ts`, add a listener to re-fetch unread counts.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAuth.tsx src/pages/MapView.tsx src/pages/Chat.tsx src/pages/EmergencyChat.tsx src/hooks/useUnreadCount.ts package.json capacitor.config.ts
git commit -m "feat: replace visibilitychange with @capacitor/app lifecycle, add data refresh on resume"
```

---

### Task 10: Update useAuth to Use iOS LocationPlugin for Tracking Control

**Files:**
- Modify: `src/hooks/useAuth.tsx`

- [ ] **Step 1: Add LocationPlugin calls for iOS**

When `tracking_enabled` changes, notify the native iOS LocationManager:

```typescript
import { Capacitor } from '@capacitor/core';

// Inside the tracking toggle logic (wherever tracking_enabled is updated):
const updateTracking = async (enabled: boolean) => {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
    try {
      // Call native LocationPlugin
      await Capacitor.nativeCallback('LocationPlugin', 'setTrackingEnabled', { enabled });
    } catch (e) {
      console.error('Failed to update native tracking:', e);
    }
  }
  // ... existing Supabase update logic
};
```

When starting location updates on login (iOS):

```typescript
// After login, start native iOS location service
if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    Capacitor.nativeCallback('LocationPlugin', 'startLocationUpdates', {
      userId: user.id,
      authToken: session.access_token
    });
  }
}
```

On logout, stop native iOS location:

```typescript
if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
  Capacitor.nativeCallback('LocationPlugin', 'stopLocationUpdates', {});
}
```

- [ ] **Step 2: Handle foreground/background accuracy switching**

In the `appStateChange` handler from Task 9:

```typescript
const handleAppStateChange = async (state: { isActive: boolean }) => {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
    if (state.isActive) {
      Capacitor.nativeCallback('LocationPlugin', 'setForegroundAccuracy', {});
    } else {
      Capacitor.nativeCallback('LocationPlugin', 'setBackgroundAccuracy', {});
    }
  }
  if (state.isActive && user?.id) {
    sendHeartbeat(user.id);
    refreshOnResume?.();
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAuth.tsx
git commit -m "feat: integrate iOS LocationPlugin for tracking control and accuracy switching"
```

---

### Task 11: Regenerate Supabase Types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regenerate types from updated schema**

```bash
npx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

This will:
- Remove `is_online` from the profiles Row type
- Add `get_online_users_count` and `get_online_users_count_by_city` to the Functions types

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase types after schema changes"
```

---

### Task 12: Final Integration Testing

- [ ] **Step 1: Test online status accuracy**

1. Open the app as User A
2. Verify User A appears online on the map (green marker)
3. Turn off internet on User A's device
4. Wait 3+ minutes
5. Verify User A appears offline on other users' map (red marker)
6. Turn internet back on
7. Verify User A appears online again within 30 seconds

- [ ] **Step 2: Test tracking disabled = offline**

1. As User A, disable location tracking
2. Verify User A appears offline on other users' map
3. Re-enable tracking
4. Verify User A appears online again

- [ ] **Step 3: Test logout = offline**

1. As User A, log out
2. Verify User A appears offline on other users' map

- [ ] **Step 4: Test iOS background location**

1. Open app on iOS device
2. Send app to background
3. Move to a different location
4. Check Supabase dashboard: `last_heartbeat_at` and `latitude/longitude` should keep updating
5. Verify proximity alerts fire when near another QH

- [ ] **Step 5: Test Android background location (regression)**

1. Verify Android background location still works (no regressions)
2. Verify proximity alerts still fire on Android

- [ ] **Step 6: Test data refresh on resume**

1. Open app, note current data
2. Send app to background
3. Have another user send a message
4. Bring app back to foreground
5. Verify new message appears without manual refresh

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for online status and background mode"
```