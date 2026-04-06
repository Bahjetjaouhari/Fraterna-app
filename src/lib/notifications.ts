import { supabase } from '@/integrations/supabase/client';

type NotificationType =
  | 'emergency_message'
  | 'global_message'
  | 'friend_request'
  | 'friend_accepted'
  | 'test';

interface NotificationData {
  // Emergency message
  message?: string;
  city?: string | null;

  // Friend requests
  from_user_id?: string;
  to_user_id?: string;

  // Test
  token?: string;
  title?: string;
  body?: string;
}

/**
 * Send push notification via Edge Function
 * @param type - Type of notification
 * @param data - Data for the notification
 * @returns Promise with result
 */
export async function sendPushNotification(
  type: NotificationType,
  data: NotificationData
): Promise<{ success: boolean; sent?: number; total?: number; error?: string }> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ type, data }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[PushNotification] Error:', result);
      return { success: false, error: result.error || 'Unknown error' };
    }

    console.log('[PushNotification] Success:', result);
    return {
      success: true,
      sent: result.sent,
      total: result.total
    };
  } catch (error) {
    console.error('[PushNotification] Exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Send emergency message notification to users in the same city
 */
export async function sendEmergencyMessageNotification(
  message: string,
  city: string | null,
  senderId: string
): Promise<{ success: boolean; sent?: number; error?: string }> {
  return sendPushNotification('emergency_message', {
    message,
    city,
    user_id: senderId,
  });
}

/**
 * Send global chat message notification to all users
 */
export async function sendGlobalMessageNotification(
  message: string,
  senderId: string
): Promise<{ success: boolean; sent?: number; error?: string }> {
  return sendPushNotification('global_message', {
    message,
    user_id: senderId,
  });
}

/**
 * Send friend request notification
 */
export async function sendFriendRequestNotification(
  fromUserId: string,
  toUserId: string
): Promise<{ success: boolean; sent?: number; error?: string }> {
  return sendPushNotification('friend_request', {
    from_user_id: fromUserId,
    to_user_id: toUserId,
  });
}

/**
 * Send friend request accepted notification
 */
export async function sendFriendAcceptedNotification(
  accepterUserId: string,
  originalRequesterUserId: string
): Promise<{ success: boolean; sent?: number; error?: string }> {
  return sendPushNotification('friend_accepted', {
    from_user_id: accepterUserId,
    to_user_id: originalRequesterUserId,
  });
}

/**
 * Send test notification (for debugging)
 */
export async function sendTestNotification(
  token: string,
  title?: string,
  body?: string
): Promise<{ success: boolean; sent?: number; error?: string }> {
  return sendPushNotification('test', {
    token,
    title,
    body,
  });
}