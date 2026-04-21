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