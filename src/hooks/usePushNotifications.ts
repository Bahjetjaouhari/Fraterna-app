import { useState, useEffect } from 'react';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export const usePushNotifications = () => {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const { session } = useAuth();
  
  useEffect(() => {
    // Only run this on native platforms (iOS/Android), not on the web
    if (!Capacitor.isNativePlatform()) {
      console.log('Push notifications not supported on web natively via Capacitor without Firebase config.');
      return;
    }

    const initPushNotifications = async () => {
      try {
        // 1. Request permission
        let permStatus = await PushNotifications.checkPermissions();

        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.warn('User denied push notification permissions');
          return;
        }

        // 2. Register with Apple / Google to receive token
        await PushNotifications.register();

        // 3. Setup Listeners
        // On success, we receive the token
        await PushNotifications.addListener('registration', async (token: Token) => {
          console.log('Push registration success, token: ' + token.value);
          setFcmToken(token.value);
          
          // If user is logged in, save token to their profile in Supabase
          if (session?.user?.id) {
            const { error } = await supabase
              .from('profiles')
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .update({ push_token: token.value } as any) // Assuming we might add push_token later
              .eq('id', session.user.id);
            
            if (error) {
              console.error('Error saving push token to Supabase:', error);
            } else {
              console.log('Push token saved to Supabase successfully');
            }
          }
        });

        // Some issue with our setup and push will not work
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error on push registration: ' + JSON.stringify(error));
        });

        // Show us the notification payload if the app is open on our device
        await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
          console.log('Push received: ' + JSON.stringify(notification));
          toast(notification.title || 'New Notification', {
            description: notification.body || '',
          });
        });

        // Method called when tapping on a notification
        await PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
          console.log('Push action performed: ' + JSON.stringify(notification));
          // Here we would typically route to a specific chat or screen based on the notification data
        });

      } catch (error) {
        console.error('Error initializing push notifications:', error);
      }
    };

    initPushNotifications();

    // Cleanup listeners when component unmounts
    return () => {
      if (Capacitor.isNativePlatform()) {
        PushNotifications.removeAllListeners();
      }
    };
  }, [session?.user?.id]); // Re-run if user ID changes

  return { fcmToken };
};
