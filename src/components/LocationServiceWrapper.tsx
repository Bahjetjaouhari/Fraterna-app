import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLocationService } from '@/hooks/useLocationService';
import { useAuth } from '@/hooks/useAuth';

/**
 * LocationServiceWrapper - Ensures the native location service is running
 * when the user is logged in and tracking is enabled.
 *
 * Note: The primary location service start happens in useAuth.tsx which
 * calls startLocationUpdates directly. This wrapper provides a secondary
 * check for service status and handles tracking toggle changes.
 */
export const LocationServiceWrapper = () => {
  const { user, profile, session } = useAuth();
  const { isRunning, checkStatus } = useLocationService();

  // Check service status on mount and when user/profile changes
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    checkStatus();
  }, [user, profile?.tracking_enabled, checkStatus]);

  // Handle tracking toggle — inform native side when tracking is disabled
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user) return;

    const shouldTrack = profile?.tracking_enabled !== false && profile?.stealth_mode !== true;

    if (!shouldTrack && isRunning) {
      // Signal native side to stop sending location updates
      Capacitor.nativeCallback('LocationService', 'setTrackingEnabled', { enabled: false });
    } else if (shouldTrack && isRunning) {
      Capacitor.nativeCallback('LocationService', 'setTrackingEnabled', { enabled: true });
    }
  }, [user, profile?.tracking_enabled, profile?.stealth_mode, isRunning]);

  // This component doesn't render anything
  return null;
};