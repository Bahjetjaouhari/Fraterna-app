import { useState, useEffect, createContext, useContext, ReactNode, useRef, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { supabase } from '@/integrations/supabase/client';
import { LocationService } from '@/hooks/useLocationService';
import { logActivity } from '@/utils/activityLog';

interface Profile {
  id: string;
  full_name: string;
  country: string;
  city: string;
  lodge: string;
  phone: string | null;
  email: string;
  photo_url: string | null;
  is_verified: boolean;
  verification_status: 'pending' | 'verified' | 'blocked' | 'manual_review';
  tracking_enabled: boolean;
  stealth_mode: boolean;
  location_visibility_mode?: "public" | "friends" | "friends_selected";
  location_allowlist_user_ids?: string[] | null;
  proximity_radius_km?: number;
  proximity_alerts_enabled?: boolean;
  last_seen_at: string | null;
  last_heartbeat_at: string | null; // Timestamp for online status (heartbeat)
  created_at: string;
  updated_at: string;
  is_active?: boolean;
  current_device_id?: string | null;
}

interface UserRole {
  id: number;
  user_id: string;
  role: 'user' | 'admin' | 'ceo';
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  isLoading: boolean;
  isVerified: boolean;
  isAdmin: boolean;
  isCeo: boolean;
  signUp: (email: string, password: string, metadata: Record<string, string>) => Promise<{ error: Error | null; data: unknown }>;
  signIn: (email: string, password: string, force?: boolean) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Heartbeat interval in milliseconds (30 seconds)
// Heartbeat is sent to track last activity time, but user is considered online
// as long as last_heartbeat_at is not null (only cleared on explicit logout)
const HEARTBEAT_INTERVAL = 30000;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isForcingLogin, setIsForcingLogin] = useState(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSendingHeartbeatRef = useRef(false);
  const nativeServiceStartedRef = useRef(false);

  const forceLogoutBannedUser = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    // Stop native location service on force logout
    if (Capacitor.isNativePlatform()) {
      try {
        LocationService.stopLocationUpdates();
      } catch (e) {
        console.error('Failed to stop location service on force logout:', e);
      }
    }
  };

  // Get or generate a persistent local device ID for this browser/device
  // Uses Capacitor Preferences on native platforms for persistent storage
  const getLocalDeviceId = async () => {
    const storageKey = 'fraterna_device_id';

    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key: storageKey });
      if (value) return value;

      const newDeviceId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      await Preferences.set({ key: storageKey, value: newDeviceId });
      return newDeviceId;
    } else {
      // Web fallback to localStorage
      let deviceId = localStorage.getItem(storageKey);
      if (!deviceId) {
        deviceId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        localStorage.setItem(storageKey, deviceId);
      }
      return deviceId;
    }
  };

  // Send heartbeat to update last_heartbeat_at timestamp
  const sendHeartbeat = async (userId: string) => {
    if (isSendingHeartbeatRef.current) return;
    isSendingHeartbeatRef.current = true;

    // Safety timeout: reset the flag after 10 seconds in case the request hangs
    // (e.g. app going to background while request is in flight)
    const timeoutId = setTimeout(() => {
      isSendingHeartbeatRef.current = false;
    }, 10000);

    try {
      await supabase
        .from('profiles')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('id', userId);
    } catch (error) {
      console.error('Heartbeat error:', error);
    } finally {
      clearTimeout(timeoutId);
      isSendingHeartbeatRef.current = false;
    }
  };

  // Start heartbeat interval
  const startHeartbeat = (userId: string) => {
    // Send initial heartbeat
    sendHeartbeat(userId);

    // Clear existing interval if any
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    // Start native location service only ONCE (not on every token refresh)
    if (!nativeServiceStartedRef.current && Capacitor.isNativePlatform()) {
      nativeServiceStartedRef.current = true;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) {
          try {
            LocationService.startLocationUpdates({
              userId: userId,
              authToken: session.access_token
            });
            // JS-side debug log to track when native service starts
            // Include build version so we can verify which build is running
            supabase.from('profiles').update({
              last_debug_event: `js_v41_start @ ${new Date().toISOString()}`
            }).eq('id', userId).then(({ error }) => {
              if (error) console.error('[Auth] Debug log error:', error.message);
            });
          } catch (e) {
            console.error('Failed to start native location service:', e);
            nativeServiceStartedRef.current = false;
          }
        }
      });
    }

    // Set up interval for subsequent heartbeats
    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat(userId);
    }, HEARTBEAT_INTERVAL);
  };

  // Stop heartbeat interval
  const stopHeartbeat = () => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    nativeServiceStartedRef.current = false;
  };

  const fetchProfile = async (userId: string) => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        return;
      }

      // 🔴 BLOQUEO REAL DEL USUARIO BANEADO
      if (profileData && profileData.is_active === false) {
        console.warn('Usuario baneado detectado, cerrando sesión');
        await forceLogoutBannedUser();
        alert('Tu cuenta ha sido suspendida. Contacta a un administrador.');
        return;
      }

      if (profileData) {
        // 🔴 CHECK FOR SINGLE DEVICE LOCK
        const localDeviceId = await getLocalDeviceId();
        // @ts-expect-error missing column in generated types
        if (profileData.current_device_id && profileData.current_device_id !== localDeviceId && !isForcingLogin) {
          console.warn('Sesión iniciada en otro dispositivo, cerrando sesión local');
          await forceLogoutBannedUser();
          alert('Tu sesión ha sido iniciada en otro dispositivo.');
          return;
        }

        setProfile(profileData as Profile);
      }

      // Roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userId);

      if (rolesError) {
        console.error('Error fetching roles:', rolesError);
        return;
      }

      setRoles((rolesData || []) as UserRole[]);
    } catch (error) {
      console.error('Error in fetchProfile:', error);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  // Sync tracking settings to native location service (iOS + Android)
  // Stealth mode only hides location from other users — heartbeats must
  // always continue so the user stays "online" even in stealth.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !profile) return;
    try {
      LocationService.setTrackingEnabled({ enabled: profile.tracking_enabled });
      LocationService.setStealthMode({ enabled: profile.stealth_mode });
    } catch (e) {
      console.error('Failed to sync tracking state to native:', e);
    }
  }, [profile?.tracking_enabled, profile?.stealth_mode]);

  useEffect(() => {
    // Safety timeout: if getSession never resolves (network issue),
    // force loading to false after 8 seconds so the app isn't stuck forever
    const loadingTimeout = setTimeout(() => {
      setIsLoading(false);
      console.warn('[Auth] getSession timed out after 8s, forcing isLoading=false');
    }, 8000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(loadingTimeout);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        // Start heartbeat when session is restored
        startHeartbeat(session.user.id);
      }
      setIsLoading(false);
    }).catch((error) => {
      clearTimeout(loadingTimeout);
      console.error('[Auth] getSession failed:', error);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(() => fetchProfile(session.user.id), 100);
          // Start heartbeat when user logs in
          startHeartbeat(session.user.id);

          // Push fresh token to native service on every auth state change
          // (especially TOKEN_REFRESHED) so native code always has a valid token
          if (Capacitor.isNativePlatform() && session.access_token) {
            try {
              LocationService.updateAuthToken({
                authToken: session.access_token,
                userId: session.user.id
              });
            } catch (e) {
              console.error('Failed to push fresh token to native service:', e);
            }
          }
        } else {
          setProfile(null);
          setRoles([]);
          stopHeartbeat();
          // Only stop native location service on explicit SIGN_OUT event.
          // Do NOT stop on SIGNED_IN, TOKEN_REFRESHED, etc. which can
          // transiently have null sessions during token refresh cycles.
          if (event === 'SIGNED_OUT' && Capacitor.isNativePlatform()) {
            try {
              LocationService.stopLocationUpdates();
            } catch (e) {
              console.error('Failed to stop location service on sign out:', e);
            }
          }
        }

        setIsLoading(false);
      }
    );

    // Handle native app state changes (pause/resume)
    // NOTE: Accuracy transitions (foreground/background) are handled entirely
    // by native NotificationCenter observers in LocationManager.swift.
    // The JS bridge does NOT call setForegroundAccuracy/setBackgroundAccuracy
    // here to avoid race conditions with the native observers.
    const setupAppStateListener = async () => {
      const appStateListener = await App.addListener('appStateChange', async (state: { isActive: boolean }) => {
        if (state.isActive && user?.id) {
          logActivity('app_open');
          // App came to foreground - send heartbeat and push fresh token to native service
          sendHeartbeat(user.id);
          window.dispatchEvent(new CustomEvent('app-resume'));
          // JS-side debug log for foreground transition
          supabase.from('profiles').update({
            last_debug_event: `js_app_foreground @ ${new Date().toISOString()}`
          }).eq('id', user.id).then();
          // Push fresh auth token to native service.
          // Read directly from Capacitor Preferences first — the native service may have
          // refreshed the token while the app was in background, and we need the JS client
          // to sync with the new session stored in Preferences.
          if (Capacitor.isNativePlatform()) {
            try {
              const { value: sessionJson } = await Preferences.get({ key: 'sb-vzlbvknauwvrqwpvtaqe-auth-token' });
              if (sessionJson) {
                const storedSession = JSON.parse(sessionJson);
                if (storedSession.access_token) {
                  LocationService.updateAuthToken({
                    authToken: storedSession.access_token,
                    userId: storedSession.user?.id || user.id
                  });
                }
              }
            } catch (e) {
              console.error('Failed to read session from Preferences on resume:', e);
            }
            // Also let Supabase JS client sync its in-memory state with storage
            const { data: { session: currentSession } } = await supabase.auth.getSession();
            if (currentSession?.access_token) {
              try {
                LocationService.updateAuthToken({
                  authToken: currentSession.access_token,
                  userId: currentSession.user.id
                });
              } catch (e) {
                console.error('Failed to push fresh token on app resume:', e);
              }
            }
          }
        } else if (!state.isActive && user?.id) {
          logActivity('app_background');
        }
      });
      return appStateListener;
    };

    let appStateListener: Awaited<ReturnType<typeof setupAppStateListener>> | null = null;
    setupAppStateListener().then(listener => {
      appStateListener = listener;
    });

    return () => {
      subscription.unsubscribe();
      stopHeartbeat();
      appStateListener?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const signUp = async (email: string, password: string, metadata: Record<string, string>) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
          emailRedirectTo: "https://fraterna-app.pages.dev/email-verified",

        },
      });
      return { error: error as Error | null, data };
    } catch (error) {
      return { error: error as Error, data: null };
    }
  };

  const signIn = async (email: string, password: string, force: boolean = false) => {
    try {
      if (force) {
        setIsForcingLogin(true);
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setIsForcingLogin(false);
        throw error;
      }

      if (data?.user) {
        // Enforce Single Device Lock
        const { data: profileCheck } = await supabase
          .from('profiles')
          .select('current_device_id')
          .eq('id', data.user.id)
          .single();

        const localDeviceId = await getLocalDeviceId();

        // @ts-expect-error missing column in generated types
        if (profileCheck?.current_device_id && profileCheck.current_device_id !== localDeviceId && !force) {
          // Si no está forzando y la cuenta la tiene otro
          await supabase.auth.signOut();
          return { error: new Error('session_active_elsewhere') };
        }

        // Registrar el nuevo dispositivo
        // @ts-expect-error missing column in generated types
        await supabase.from('profiles').update({ current_device_id: localDeviceId }).eq('id', data.user.id);

        // Start heartbeat on login
        startHeartbeat(data.user.id);
        logActivity('login', { method: 'password' });

        if (force) {
          // Ya se actualizó en BD, podemos quitar la bandera y recargar
          setIsForcingLogin(false);
          await fetchProfile(data.user.id);
        }
      }

      return { error: null };
    } catch (error) {
      setIsForcingLogin(false);
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    logActivity('logout');
    // Stop heartbeat and clear session data
    stopHeartbeat();

    // Stop native location service (iOS + Android)
    if (Capacitor.isNativePlatform()) {
      try {
        LocationService.stopLocationUpdates();
      } catch (e) {
        console.error('Failed to stop native location service:', e);
      }
    }

    // JS-side debug log for sign out
    if (user?.id) {
      supabase.from('profiles').update({
        last_debug_event: `js_sign_out @ ${new Date().toISOString()}`
      }).eq('id', user.id).then();
    }

    if (user?.id) {
      try {
        // Clear heartbeat timestamp and device ID on logout
        const { error } = await supabase.from('profiles').update({
          last_heartbeat_at: null,
          current_device_id: null,
        }).eq('id', user.id);

        if (error) {
          console.error('Error clearing user session data:', error);
        }
      } catch (err) {
        console.error('Exception clearing user session data:', err);
      }
    }
    await supabase.auth.signOut();
    setProfile(null);
    setRoles([]);
  };

  const isVerified = profile?.is_verified ?? false;
  const isAdmin = roles.some((r) => r.role === 'admin' || r.role === 'ceo');
  const isCeo = roles.some((r) => r.role === 'ceo');

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        isLoading,
        isVerified,
        isAdmin,
        isCeo,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};