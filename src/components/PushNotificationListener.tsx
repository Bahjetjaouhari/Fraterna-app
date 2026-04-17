import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Capacitor } from '@capacitor/core';

export const PushNotificationListener = () => {
  const { debugStatus } = usePushNotifications();

  // Only show debug info on native platforms during debugging
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        right: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        color: '#0f0',
        fontSize: 10,
        fontFamily: 'monospace',
        padding: '6px 8px',
        borderRadius: 6,
        zIndex: 99999,
        wordBreak: 'break-all',
        lineHeight: 1.3,
        pointerEvents: 'none',
      }}
    >
      PUSH: {debugStatus}
    </div>
  );
};