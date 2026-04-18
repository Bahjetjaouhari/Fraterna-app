import { usePushNotifications } from '@/hooks/usePushNotifications';

export const PushNotificationListener = () => {
  usePushNotifications();
  return null;
};