import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLocationService } from '@/hooks/useLocationService';
import { useAuth } from '@/hooks/useAuth';

/**
 * LocationServiceWrapper - Checks native location service status.
 *
 * The primary location lifecycle (start/stop/tracking) is managed entirely
 * by useAuth.tsx to avoid duplicate calls and race conditions.
 * This wrapper only monitors service status for UI indicators.
 */
export const LocationServiceWrapper = () => {
  const { user } = useAuth();
  const { checkStatus } = useLocationService();

  // Check service status on mount and when user changes
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    checkStatus();
  }, [user, checkStatus]);

  // This component doesn't render anything
  return null;
};