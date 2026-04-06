import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// LocationService plugin interface
interface LocationServicePlugin {
  startLocationService: () => Promise<{ success: boolean }>;
  stopLocationService: () => Promise<{ success: boolean }>;
  isServiceRunning: () => Promise<{ running: boolean }>;
  getLastKnownLocation: () => Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  }>;
}

// Dynamic import for Capacitor plugin
const LocationService = Capacitor.registerPlugin<LocationServicePlugin>('LocationService');

export const useLocationService = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [lastLocation, setLastLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  } | null>(null);
  const { user } = useAuth();

  // Check if service is running
  const checkStatus = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const result = await LocationService.isServiceRunning();
      setIsRunning(result.running);
    } catch (error) {
      console.error('Error checking location service status:', error);
    }
  }, []);

  // Start the foreground location service
  const startService = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      console.log('Location service not available on web');
      return false;
    }

    try {
      await LocationService.startLocationService();
      setIsRunning(true);
      console.log('Location service started');
      return true;
    } catch (error) {
      console.error('Error starting location service:', error);
      return false;
    }
  }, []);

  // Stop the foreground location service
  const stopService = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await LocationService.stopLocationService();
      setIsRunning(false);
      console.log('Location service stopped');
    } catch (error) {
      console.error('Error stopping location service:', error);
    }
  }, []);

  // Get last known location from the service
  const getLastLocation = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return null;

    try {
      const location = await LocationService.getLastKnownLocation();
      setLastLocation(location);
      return location;
    } catch (error) {
      console.error('Error getting last location:', error);
      return null;
    }
  }, []);

  // Update location in Supabase when we get a new location
  const updateLocationInDatabase = useCallback(async (
    latitude: number,
    longitude: number,
    accuracy: number
  ) => {
    if (!user?.id) return;

    try {
      const { error } = await supabase
        .from('locations')
        .upsert(
          {
            user_id: user.id,
            lat: latitude,
            lng: longitude,
            accuracy_meters: Math.round(accuracy),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) throw error;

      // Update last_seen_at in profile
      await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', user.id);

      console.log('Location updated in database');
    } catch (error) {
      console.error('Error updating location in database:', error);
    }
  }, [user?.id]);

  // Poll for location updates from the service
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !isRunning) return;

    const pollInterval = setInterval(async () => {
      const location = await getLastLocation();
      if (location && user?.id) {
        await updateLocationInDatabase(
          location.latitude,
          location.longitude,
          location.accuracy
        );
      }
    }, 15000); // Poll every 15 seconds

    return () => clearInterval(pollInterval);
  }, [isRunning, getLastLocation, updateLocationInDatabase, user?.id]);

  // Check status on mount
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    isRunning,
    lastLocation,
    startService,
    stopService,
    getLastLocation,
    checkStatus,
  };
};