import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isForcingLogin, setIsForcingLogin] = useState(false);

  const forceLogoutBannedUser = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
  };

  // Get or generate a persistent local device ID for this browser/device
  const getLocalDeviceId = () => {
    let deviceId = localStorage.getItem('fraterna_device_id');
    if (!deviceId) {
      deviceId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      localStorage.setItem('fraterna_device_id', deviceId);
    }
    return deviceId;
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
        const localDeviceId = getLocalDeviceId();
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(() => fetchProfile(session.user.id), 100);
        } else {
          setProfile(null);
          setRoles([]);
        }

        setIsLoading(false);
      }
    );

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          
        const localDeviceId = getLocalDeviceId();
        
        // @ts-expect-error missing column in generated types
        if (profileCheck?.current_device_id && profileCheck.current_device_id !== localDeviceId && !force) {
          // Si no está forzando y la cuenta la tiene otro
          await supabase.auth.signOut();
          return { error: new Error('session_active_elsewhere') };
        }
        
        // Registrar el nuevo dispositivo
        // @ts-expect-error missing column in generated types
        await supabase.from('profiles').update({ current_device_id: localDeviceId }).eq('id', data.user.id);
        
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
    // Mark user as inactive before closing session
    if (user?.id) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await supabase.from('profiles').update({ last_seen_at: null, current_device_id: null }).eq('id', user.id);
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
