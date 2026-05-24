-- User activity logging for admin monitoring
CREATE TABLE user_activity_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event text NOT NULL,
  details jsonb DEFAULT '{}',
  platform text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_activity_log_user_time ON user_activity_log(user_id, created_at DESC);
CREATE INDEX idx_activity_log_event ON user_activity_log(event, created_at DESC);
CREATE INDEX idx_activity_log_time ON user_activity_log(created_at DESC);

ALTER TABLE user_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own activity"
  ON user_activity_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all activity"
  ON user_activity_log FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );