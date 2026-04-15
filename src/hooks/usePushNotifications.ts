import { useState, useEffect, useRef } from 'react';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// Clear badge on Android
const clearBadge = async () => {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await PushNotifications.removeAllDeliveredNotifications();
      console.log('Badge cleared');
    } catch (error) {
      console.error('Error clearing badge:', error);
    }
  }
};

export const usePushNotifications = () => {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const { session } = useAuth();
  const isInitialized = useRef(false);
  const savedToken = useRef<string | null>(null);

  // Save token to profile whenever session or token changes
  const saveTokenToProfile = async (token: string) => {
    if (!session?.user?.id) return;

    console.log('Saving push token to profile, token starts with:', token.substring(0, 20));

    const { error } = await supabase
      .from('profiles')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ push_token: token } as any)
      .eq('id', session.user.id);

    if (error) {
      console.error('Error saving push token to Supabase:', error);
    } else {
      console.log('Push token saved to Supabase successfully');
    }
  };

  // Save token when session becomes available
  useEffect(() => {
    if (savedToken.current && session?.user?.id) {
      saveTokenToProfile(savedToken.current);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    // Only run on native platforms
    if (!Capacitor.isNativePlatform()) {
      console.log('Push notifications not supported on web');
      return;
    }

    if (isInitialized.current) {
      console.log('Push notifications already initialized, skipping...');
      return;
    }

    const initPushNotifications = async () => {
      try {
        // Clear any existing badges on app start
        await clearBadge();

        // 1. Request permission
        let permStatus = await PushNotifications.checkPermissions();

        if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.warn('Push notification permission not granted:', permStatus.receive);
          return;
        }

        // 2. Register with Apple/Google to receive token
        await PushNotifications.register();

        // 3. Setup Listeners (only once)
        // On success, we receive the token
        await PushNotifications.addListener('registration', async (token: Token) => {
          console.log('Push registration success, token: ' + token.value.substring(0, 30) + '...');
          setFcmToken(token.value);
          savedToken.current = token.value;

          // Save token to profile
          if (session?.user?.id) {
            await saveTokenToProfile(token.value);
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
        await PushNotifications.addListener('pushNotificationActionPerformed', async (notification: ActionPerformed) => {
          console.log('Push action performed: ' + JSON.stringify(notification));
          await clearBadge();
        });

        isInitialized.current = true;
        console.log('Push notifications initialized successfully');

      } catch (error) {
        console.error('Error initializing push notifications:', error);
      }
    };

    initPushNotifications();

    return () => {
      if (Capacitor.isNativePlatform() && isInitialized.current) {
        console.log('Cleaning up push notification listeners');
        PushNotifications.removeAllListeners();
        isInitialized.current = false;
      }
    };
  }, []);

  return { fcmToken };
};