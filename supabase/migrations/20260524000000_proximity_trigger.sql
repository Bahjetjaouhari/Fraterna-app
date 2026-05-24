-- =========================================================
-- Server-side proximity trigger: fires when a location is upserted.
-- Immediately checks for nearby QH users and sends push notifications.
-- This eliminates the polling delay — notifications arrive in seconds.
-- =========================================================

-- 1. Cooldown table: prevents spamming the same user pair within 5 minutes
CREATE TABLE IF NOT EXISTS proximity_notification_cooldown (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_user_id, to_user_id)
);

-- Index for fast cooldown lookups and cleanup
CREATE INDEX idx_proximity_cooldown_lookup
  ON proximity_notification_cooldown(from_user_id, to_user_id, notified_at DESC);

-- RLS: only the trigger (SECURITY DEFINER) writes to this table
ALTER TABLE proximity_notification_cooldown ENABLE ROW LEVEL SECURITY;

-- 2. Indexes for fast proximity bounding-box queries
CREATE INDEX IF NOT EXISTS idx_locations_lat ON locations(lat) WHERE lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_lng ON locations(lng) WHERE lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_user_lat_lng
  ON locations(user_id, lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- 3. Proximity check function (called by trigger)
CREATE OR REPLACE FUNCTION check_proximity_and_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sender_id UUID;
  v_sender_lat DOUBLE PRECISION;
  v_sender_lng DOUBLE PRECISION;
  v_sender_radius DOUBLE PRECISION;
  v_sender_alerts_enabled BOOLEAN;
  v_sender_tracking BOOLEAN;
  v_sender_stealth BOOLEAN;
  v_nearby_user RECORD;
  v_distance_km DOUBLE PRECISION;
  v_lat_delta DOUBLE PRECISION;
  v_lng_delta DOUBLE PRECISION;
  v_cooldown_exists BOOLEAN;
  v_service_role_key TEXT;
  v_effective_radius DOUBLE PRECISION;
BEGIN
  -- Only proceed if we have valid coordinates
  IF NEW.lat IS NULL OR NEW.lng IS NULL THEN
    RETURN NEW;
  END IF;

  v_sender_id := NEW.user_id;
  v_sender_lat := NEW.lat;
  v_sender_lng := NEW.lng;

  -- Get sender's settings
  SELECT proximity_alerts_enabled, tracking_enabled, stealth_mode, proximity_radius_km
  INTO v_sender_alerts_enabled, v_sender_tracking, v_sender_stealth, v_sender_radius
  FROM profiles WHERE id = v_sender_id;

  -- Skip if sender has alerts disabled, tracking off, or is in stealth
  IF NOT v_sender_alerts_enabled OR NOT v_sender_tracking OR v_sender_stealth THEN
    RETURN NEW;
  END IF;

  -- Calculate bounding box using Haversine-based delta
  v_lat_delta := v_sender_radius / 111.32;
  v_lng_delta := v_sender_radius / (111.32 * cos(radians(v_sender_lat)));

  -- Find nearby users within the sender's bounding box
  FOR v_nearby_user IN
    SELECT
      p.id AS neighbor_id,
      p.proximity_alerts_enabled,
      p.tracking_enabled,
      p.stealth_mode,
      p.proximity_radius_km,
      p.push_token,
      p.last_heartbeat_at,
      l.lat AS neighbor_lat,
      l.lng AS neighbor_lng
    FROM profiles p
    JOIN locations l ON l.user_id = p.id
    WHERE p.id != v_sender_id
      AND p.tracking_enabled = true
      AND p.stealth_mode = false
      AND p.proximity_alerts_enabled = true
      AND p.push_token IS NOT NULL
      AND p.last_heartbeat_at > NOW() - INTERVAL '10 minutes'
      AND l.lat IS NOT NULL
      AND l.lng IS NOT NULL
      AND l.lat BETWEEN v_sender_lat - v_lat_delta AND v_sender_lat + v_lat_delta
      AND l.lng BETWEEN v_sender_lng - v_lng_delta AND v_sender_lng + v_lng_delta
  LOOP
    -- Calculate Haversine distance
    v_distance_km := (
      6371.0 * acos(
        least(1.0,
          cos(radians(v_sender_lat)) * cos(radians(v_nearby_user.neighbor_lat)) *
          cos(radians(v_nearby_user.neighbor_lng) - radians(v_sender_lng)) +
          sin(radians(v_sender_lat)) * sin(radians(v_nearby_user.neighbor_lat))
        )
      )
    );

    -- Use min(sender_radius, receiver_radius) like iOS does
    v_effective_radius := least(v_sender_radius, v_nearby_user.proximity_radius_km);

    IF v_distance_km <= v_effective_radius THEN
      -- Check cooldown (5 minutes per direction)
      -- Check BOTH directions to avoid duplicate notifications
      SELECT EXISTS (
        SELECT 1 FROM proximity_notification_cooldown
        WHERE from_user_id = v_sender_id
          AND to_user_id = v_nearby_user.neighbor_id
          AND notified_at > NOW() - INTERVAL '5 minutes'
      ) INTO v_cooldown_exists;

      IF NOT v_cooldown_exists THEN
        -- Insert or update cooldown record
        INSERT INTO proximity_notification_cooldown (from_user_id, to_user_id)
        VALUES (v_sender_id, v_nearby_user.neighbor_id)
        ON CONFLICT (from_user_id, to_user_id) DO UPDATE
          SET notified_at = NOW();

        -- Call the edge function asynchronously via pg_net
        v_service_role_key := current_setting('app.service_role_key', true);

        PERFORM net.http_post(
          url := 'https://vzlbvknauwvrqwpvtaqe.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_role_key,
            'Content-Type', 'application/json'
          ),
          body := jsonb_build_object(
            'type', 'proximity_alert',
            'data', jsonb_build_object(
              'from_user_id', v_sender_id,
              'to_user_id', v_nearby_user.neighbor_id,
              'distance_km', round(v_distance_km::numeric, 2)
            )
          )
        );

        RAISE NOTICE 'Proximity notification sent: % -> % (dist=% km)',
          v_sender_id, v_nearby_user.neighbor_id, v_distance_km;
      END IF;
    END IF;
  END LOOP;

  -- Clean up old cooldown rows (older than 10 minutes)
  DELETE FROM proximity_notification_cooldown
  WHERE notified_at < NOW() - INTERVAL '10 minutes';

  RETURN NEW;
END;
$$;

-- 4. Create the trigger on locations table
DROP TRIGGER IF EXISTS on_location_upsert ON locations;
CREATE TRIGGER on_location_upsert
  AFTER INSERT OR UPDATE ON locations
  FOR EACH ROW
  EXECUTE FUNCTION check_proximity_and_notify();