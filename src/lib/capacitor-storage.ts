import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

/**
 * Custom storage adapter for Supabase that uses Capacitor Preferences
 * on native platforms (iOS/Android) for persistent storage.
 * Falls back to localStorage on web.
 */
export const createCapacitorStorage = () => {
  const isNative = Capacitor.isNativePlatform();

  return {
    getItem: async (key: string): Promise<string | null> => {
      if (isNative) {
        const { value } = await Preferences.get({ key });
        return value;
      }
      return localStorage.getItem(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (isNative) {
        await Preferences.set({ key, value });
      } else {
        localStorage.setItem(key, value);
      }
    },
    removeItem: async (key: string): Promise<void> => {
      if (isNative) {
        await Preferences.remove({ key });
      } else {
        localStorage.removeItem(key);
      }
    },
  };
};