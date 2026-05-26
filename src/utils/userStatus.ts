export interface UserStatusProfile {
  last_heartbeat_at: string | null;
  tracking_enabled: boolean | null;
}

// Must match the 5-minute threshold used in SQL is_user_active()
// Heartbeats fire every 60-90s natively, so 5 minutes gives enough buffer
// even if a single heartbeat is delayed by Doze mode or iOS throttling.
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export function isUserOnline(profile: UserStatusProfile): boolean {
  if (!profile.last_heartbeat_at) return false;
  if (!profile.tracking_enabled) return false;
  const thresholdAgo = Date.now() - ONLINE_THRESHOLD_MS;
  return new Date(profile.last_heartbeat_at).getTime() > thresholdAgo;
}