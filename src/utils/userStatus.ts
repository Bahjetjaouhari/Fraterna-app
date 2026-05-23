export interface UserStatusProfile {
  last_heartbeat_at: string | null;
  tracking_enabled: boolean | null;
}

// Must match the 10-minute threshold used in SQL is_user_active()
// 10 minutes gives enough buffer for Doze mode (Android) and iOS suspension
// which can delay heartbeats by 5-15+ minutes when Apple throttles silent pushes
const ONLINE_THRESHOLD_MS = 10 * 60 * 1000;

export function isUserOnline(profile: UserStatusProfile): boolean {
  if (!profile.last_heartbeat_at) return false;
  if (!profile.tracking_enabled) return false;
  const thresholdAgo = Date.now() - ONLINE_THRESHOLD_MS;
  return new Date(profile.last_heartbeat_at).getTime() > thresholdAgo;
}