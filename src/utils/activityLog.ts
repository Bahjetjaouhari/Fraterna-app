import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";

export type ActivityEvent =
  | 'app_open'
  | 'app_background'
  | 'login'
  | 'logout'
  | 'chat_message'
  | 'emergency_message'
  | 'profile_update'
  | 'stealth_toggle'
  | 'tracking_toggle'
  | 'proximity_toggle'
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_removed'
  | 'visibility_change'
  | 'radius_change';

export async function logActivity(
  event: ActivityEvent,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.warn("[activityLog] auth.getUser error:", authError.message);
    }
    if (!user) {
      console.warn("[activityLog] no user, skipping:", event);
      return;
    }

    const platform = Capacitor.isNativePlatform()
      ? Capacitor.getPlatform()
      : 'web';

    const { error: insertError } = await supabase.from("user_activity_log").insert({
      user_id: user.id,
      event,
      details: details ?? {},
      platform,
    });
    if (insertError) {
      console.warn("[activityLog] insert error:", insertError.message);
    }
  } catch (err) {
    console.warn("[activityLog] unexpected error:", err);
  }
}