-- Update heartbeat threshold from 3 minutes to 5 minutes
-- to tolerate background OS restrictions (Doze mode, iOS suspension).
-- Android Doze can delay heartbeats by 9+ minutes.
-- iOS suspension can delay heartbeats by 5-15+ minutes for stationary users.
-- 5 minutes provides a buffer while still detecting genuinely offline users.
-- Must match ONLINE_THRESHOLD_SECONDS in LocationForegroundService.kt (300)
-- Must match FIVE_MINUTES_MS in userStatus.ts (300000)

-- Update is_user_active
CREATE OR REPLACE FUNCTION is_user_active(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = uid
    AND last_heartbeat_at > NOW() - INTERVAL '5 minutes'
    AND tracking_enabled = true
  );
$$ LANGUAGE sql STABLE;

-- Update get_online_users
CREATE OR REPLACE FUNCTION get_online_users()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '5 minutes'
    AND tracking_enabled = true
    AND stealth_mode = false;
END;
$$ LANGUAGE plpgsql STABLE;

-- Update get_online_users_count
CREATE OR REPLACE FUNCTION get_online_users_count()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '5 minutes'
    AND tracking_enabled = true;
$$ LANGUAGE sql STABLE;

-- Update get_online_users_count_by_city
CREATE OR REPLACE FUNCTION get_online_users_count_by_city(city_param TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '5 minutes'
    AND tracking_enabled = true
    AND city ILIKE city_param;
$$ LANGUAGE sql STABLE;
