-- Schedule keepalive-push Edge Function to run every 2 minutes
-- This wakes iOS/Android apps that have stale heartbeats via silent push
-- NOTE: The service role key is read from Supabase secrets at runtime,
-- not hardcoded. Run this in the SQL Editor with the proper key replaced.
SELECT cron.schedule(
  'keepalive-push',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vzlbvknauwvrqwpvtaqe.supabase.co/functions/v1/keepalive-push',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
      'Content-Type', 'application/json'
    )
  );
  $$
);
