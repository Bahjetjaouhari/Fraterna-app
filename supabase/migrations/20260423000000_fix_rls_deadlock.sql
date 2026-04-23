-- Fix RLS deadlock: is_user_active() blocked users from re-activating after background
-- The function requires last_heartbeat_at > NOW() - 3 minutes,
-- but when a user returns from background, their heartbeat is expired,
-- so is_user_active = false, which blocks the INSERT/UPDATE to locations table.
-- This creates a deadlock: can't update location because not active, can't become active
-- because the heartbeat update (profiles table) was also blocked in some policies.

-- Fix 1: Simplify locations INSERT policy (remove is_user_active check)
DROP POLICY IF EXISTS locations_insert_active ON locations;
DROP POLICY IF EXISTS locations_insert_owner ON locations;

CREATE POLICY locations_insert_own ON locations
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Fix 2: Simplify locations UPDATE policies (remove is_user_active check)
DROP POLICY IF EXISTS locations_update_active ON locations;
DROP POLICY IF EXISTS locations_update_owner ON locations;
DROP POLICY IF EXISTS locations_update_own ON locations;

CREATE POLICY locations_update_own ON locations
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Fix 3: Remove profiles_update_own_active (redundant with profiles_update_own)
DROP POLICY IF EXISTS profiles_update_own_active ON profiles;
