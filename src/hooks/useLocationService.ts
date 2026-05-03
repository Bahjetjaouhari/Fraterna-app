import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

// LocationService plugin interface — matches native CAPPluginRegister.m method names
interface LocationServicePlugin {
  startLocationUpdates: (options: { userId: string; authToken: string }) => Promise<void>;
  stopLocationUpdates: () => Promise<void>;
  isServiceRunning: () => Promise<{ running: boolean }>;
  setTrackingEnabled: (options: { enabled: boolean }) => Promise<void>;
  setStealthMode: (options: { enabled: boolean }) => Promise<void>;
  setForegroundAccuracy: () => Promise<void>;
  setBackgroundAccuracy: () => Promise<void>;
  updateAuthToken: (options: { authToken: string; userId?: string }) => Promise<void>;
}

export const LocationService = Capacitor.registerPlugin<LocationServicePlugin>('LocationService');

export const useLocationService = () => {
  const [isRunning, setIsRunning] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const result = await LocationService.isServiceRunning();
      setIsRunning(result.running);
    } catch (error) {
      console.error('[useLocationService] Error checking status:', error);
    }
  }, []);

  const startService = useCallback(async (userId: string, authToken: string) => {
    if (!Capacitor.isNativePlatform()) return false;

    try {
      await LocationService.startLocationUpdates({ userId, authToken });
      setIsRunning(true);
      console.log('[useLocationService] Location updates started');
      return true;
    } catch (error) {
      console.error('[useLocationService] Error starting location updates:', error);
      return false;
    }
  }, []);

  const stopService = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await LocationService.stopLocationUpdates();
      setIsRunning(false);
      console.log('[useLocationService] Location updates stopped');
    } catch (error) {
      console.error('[useLocationService] Error stopping location updates:', error);
    }
  }, []);

  return {
    isRunning,
    startService,
    stopService,
    checkStatus,
  };
};