-- Audit fixes: data integrity constraints, heartbeat default, and performance index
-- Reference: supabase_audit.md (2026-05-01)

-- Fix 1: last_heartbeat_at default NULL (prevents fake "online" on registration)
ALTER TABLE profiles ALTER COLUMN last_heartbeat_at SET DEFAULT NULL;

-- Fix 2: CHECK constraints for data integrity
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_visibility;
ALTER TABLE profiles ADD CONSTRAINT chk_visibility 
  CHECK (location_visibility_mode IN ('public', 'friends', 'private'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_role;
ALTER TABLE profiles ADD CONSTRAINT chk_role 
  CHECK (role IN ('user', 'admin', 'ceo'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_verification_status;
ALTER TABLE profiles ADD CONSTRAINT chk_verification_status 
  CHECK (verification_status IN ('pending', 'verified', 'rejected'));

ALTER TABLE friendships DROP CONSTRAINT IF EXISTS chk_friendship_status;
ALTER TABLE friendships ADD CONSTRAINT chk_friendship_status 
  CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked'));

-- Fix 3: Partial index for keepalive-push query performance
CREATE INDEX IF NOT EXISTS idx_profiles_keepalive 
  ON profiles(last_heartbeat_at) 
  WHERE push_token IS NOT NULL AND tracking_enabled = true;
