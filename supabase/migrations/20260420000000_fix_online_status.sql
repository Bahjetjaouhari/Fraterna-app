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

-- Convenience function to count online users (used by Chat.tsx)
CREATE OR REPLACE FUNCTION get_online_users_count()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '3 minutes'
    AND tracking_enabled = true;
$$ LANGUAGE sql STABLE;

-- Convenience function to count online users by city (used by EmergencyChat.tsx)
CREATE OR REPLACE FUNCTION get_online_users_count_by_city(city_param TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM profiles
  WHERE last_heartbeat_at > NOW() - INTERVAL '3 minutes'
    AND tracking_enabled = true
    AND city ILIKE city_param;
$$ LANGUAGE sql STABLE;