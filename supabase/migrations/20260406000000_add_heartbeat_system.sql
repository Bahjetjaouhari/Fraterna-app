-- Add last_heartbeat_at column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ DEFAULT NOW();

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_last_heartbeat ON profiles(last_heartbeat_at);

-- Function to check if user is online (heartbeat within last 2 minutes)
CREATE OR REPLACE FUNCTION is_user_online(user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  last_heartbeat TIMESTAMPTZ;
BEGIN
  SELECT last_heartbeat_at INTO last_heartbeat
  FROM profiles
  WHERE id = user_id;

  -- User is online if heartbeat is within last 2 minutes
  RETURN last_heartbeat IS NOT NULL
    AND last_heartbeat > NOW() - INTERVAL '2 minutes';
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get all online users (for queries)
CREATE OR REPLACE FUNCTION get_online_users()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM profiles
  WHERE last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at > NOW() - INTERVAL '2 minutes'
    AND tracking_enabled = true
    AND stealth_mode = false;
END;
$$ LANGUAGE plpgsql STABLE;

-- Trigger to set heartbeat on login (optional, can also be done from app)
CREATE OR REPLACE FUNCTION set_heartbeat_on_login()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_heartbeat_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_set_heartbeat_login ON profiles;

-- Comment: We handle heartbeat from the app, so no trigger needed for login
-- The heartbeat hook will update last_heartbeat_at every 30 seconds