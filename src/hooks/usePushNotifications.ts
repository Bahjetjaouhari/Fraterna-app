import { useState, useEffect, useRef } from 'react';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// Clear badge on native platforms (both Android and iOS)
const clearBadge = async () => {
  if (Capacitor.isNativePlatform()) {
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

  // Debug state - visible in UI to diagnose push notification issues
  const [debugStatus, setDebugStatus] = useState<string>('initializing...');

  // Save token to profile whenever session or token changes
  const saveTokenToProfile = async (token: string) => {
    if (!session?.user?.id) {
      console.log('[PUSH DEBUG] Cannot save token - no session');
      return;
    }

    console.log('Saving push token to profile, platform:', Capacitor.getPlatform(), 'token starts with:', token.substring(0, 20));

    const { error } = await supabase
      .from('profiles')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ push_token: token } as any)
      .eq('id', session.user.id);

    if (error) {
      console.error('Error saving push token to Supabase:', error);
      setDebugStatus(prev => prev + ' | SUPABASE SAVE ERROR: ' + error.message);
    } else {
      console.log('Push token saved to Supabase successfully');
      setDebugStatus(prev => prev + ' | TOKEN SAVED TO SUPABASE OK');
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
      setDebugStatus('web platform - not applicable');
      return;
    }

    if (isInitialized.current) {
      console.log('Push notifications already initialized, skipping...');
      return;
    }

    const initPushNotifications = async () => {
      const platform = Capacitor.getPlatform();
      setDebugStatus(`platform: ${platform} | starting init...`);

      try {
        // Clear any existing badges on app start
        await clearBadge();

        // 1. Request permission
        setDebugStatus(`platform: ${platform} | checking permissions...`);
        let permStatus = await PushNotifications.checkPermissions();
        setDebugStatus(`platform: ${platform} | permission: ${permStatus.receive}`);

        if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
          setDebugStatus(`platform: ${platform} | requesting permissions...`);
          permStatus = await PushNotifications.requestPermissions();
          setDebugStatus(`platform: ${platform} | permission after request: ${permStatus.receive}`);
        }

        if (permStatus.receive !== 'granted') {
          console.warn('Push notification permission not granted:', permStatus.receive);
          setDebugStatus(`platform: ${platform} | PERMISSION DENIED: ${permStatus.receive}`);
          return;
        }

        // 2. Setup listeners BEFORE registering (prevents race condition on iOS where
        //    the token arrives before the listener is attached)
        setDebugStatus(`platform: ${platform} | permission: granted | setting up listeners...`);

        // On success, we receive the token
        await PushNotifications.addListener('registration', async (token: Token) => {
          const tokenPreview = token.value.substring(0, 30);
          console.log('Push registration success, platform:', Capacitor.getPlatform(), 'token:', tokenPreview + '...');
          setFcmToken(token.value);
          savedToken.current = token.value;
          setDebugStatus(`platform: ${platform} | TOKEN RECEIVED: ${tokenPreview}... | saving...`);

          // Save token to profile
          if (session?.user?.id) {
            await saveTokenToProfile(token.value);
          } else {
            setDebugStatus(`platform: ${platform} | TOKEN: ${tokenPreview}... | NO SESSION YET`);
          }
        });

        // Some issue with our setup and push will not work
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error on push registration: ' + JSON.stringify(error));
          setDebugStatus(`platform: ${platform} | REGISTRATION ERROR: ${JSON.stringify(error)}`);
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

        // 3. Register with Apple/Google to receive token (AFTER listeners are set up)
        setDebugStatus(`platform: ${platform} | permission: granted | listeners ready | calling register()...`);
        await PushNotifications.register();

        isInitialized.current = true;
        console.log('Push notifications initialized successfully on', Capacitor.getPlatform());

      } catch (error) {
        console.error('Error initializing push notifications:', error);
        setDebugStatus(`platform: ${Capacitor.getPlatform()} | INIT ERROR: ${error}`);
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

  return { fcmToken, debugStatus };
};