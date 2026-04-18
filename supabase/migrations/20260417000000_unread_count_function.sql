-- Function to get the total unread count for a user
-- Used by Edge Function to set the correct badge number in APNS payload
-- Counts: unread global chat messages + unread emergency messages + pending friend requests
CREATE OR REPLACE FUNCTION get_unread_count(target_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  total INTEGER;
BEGIN
  SELECT
    COALESCE((SELECT COUNT(*) FROM chat_messages
      WHERE created_at > COALESCE(
        (SELECT global_last_read_at FROM chat_read_state WHERE user_id = target_user_id),
        '1970-01-01T00:00:00Z'
      ) AND deleted_by_admin = false AND user_id != target_user_id), 0)
    +
    COALESCE((SELECT COUNT(*) FROM emergency_messages
      WHERE created_at > COALESCE(
        (SELECT emergency_last_read_at FROM chat_read_state WHERE user_id = target_user_id),
        '1970-01-01T00:00:00Z'
      ) AND user_id != target_user_id), 0)
    +
    COALESCE((SELECT COUNT(*) FROM friendships
      WHERE addressee_id = target_user_id AND status = 'pending'), 0)
  INTO total;

  RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;