-- Add device_platform column to profiles for proper iOS/Android push notification routing
-- The keepalive-push function needs to know if a token is iOS or Android to send
-- the correct APNS payload (content-available: 1, apns-push-type: background).
-- Without this, FCM tokens on iOS are misclassified as Android and silent pushes fail.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS device_platform text;

-- Update the keepalive-push partial index to include device_platform
-- (drop and recreate since we can't ALTER INDEX WHERE clause)
DROP INDEX IF EXISTS idx_profiles_keepalive;
CREATE INDEX idx_profiles_keepalive
  ON profiles(last_heartbeat_at)
  WHERE push_token IS NOT NULL AND tracking_enabled = true;