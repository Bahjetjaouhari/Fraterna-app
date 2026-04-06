import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLocationService } from '@/hooks/useLocationService';
import { useAuth } from '@/hooks/useAuth';

/**
 * LocationServiceWrapper - Starts the foreground location service on Android
 * when the user is logged in and tracking is enabled.
 *
 * This ensures location updates continue even when the app is in background.
 */
export const LocationServiceWrapper = () => {
  const { user, profile } = useAuth();
  const { startService, stopService, isRunning } = useLocationService();

  useEffect(() => {
    // Only run on native platforms
    if (!Capacitor.isNativePlatform()) return;

    // Only start if user is logged in
    if (!user) {
      // Stop service when user logs out
      if (isRunning) {
        stopService();
      }
      return;
    }

    // Check if tracking is enabled and stealth mode is off
    const shouldTrack = profile?.tracking_enabled !== false && profile?.stealth_mode !== true;

    const manageService = async () => {
      if (shouldTrack && !isRunning) {
        console.log('[LocationService] Starting foreground location service');
        await startService();
      } else if (!shouldTrack && isRunning) {
        console.log('[LocationService] Stopping foreground location service');
        await stopService();
      }
    };

    manageService();
  }, [user, profile?.tracking_enabled, profile?.stealth_mode, isRunning, startService, stopService]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (Capacitor.isNativePlatform() && isRunning) {
        stopService();
      }
    };
  }, [isRunning, stopService]);

  // This component doesn't render anything
  return null;
};