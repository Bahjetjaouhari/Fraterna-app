import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Capacitor } from '@capacitor/core';
import { Badge } from '@capawesome/capacitor-badge';

interface UnreadCounts {
  global: number;
  emergency: number;
  friends: number;
  total: number;
}

// Sync native app icon badge with unread count (iOS only, Android handled differently)
const syncNativeBadge = async (count: number) => {
  if (!Capacitor.isNativePlatform()) return;

  try {
    if (count <= 0) {
      await Badge.clear();
    } else {
      await Badge.set({ count });
    }
  } catch (error) {
    console.error('Error syncing native badge:', error);
  }
};

/**
 * Hook para obtener el conteo de mensajes no leídos en cada chat
 */
export function useUnreadCount() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnreadCounts>({ global: 0, emergency: 0, friends: 0, total: 0 });

  const fetchUnreadCounts = useCallback(async () => {
    if (!user) {
      setCounts({ global: 0, emergency: 0, friends: 0, total: 0 });
      return;
    }

    try {
      // Obtener la última vez que el usuario leyó cada chat
      const { data: readState, error: readError } = await supabase
        .from('chat_read_state')
        .select('global_last_read_at, emergency_last_read_at')
        .eq('user_id', user.id)
        .single();

      if (readError || !readState) {
        console.error('Error fetching read state:', readError);
        return;
      }

      // Contar mensajes globales no leídos
      const { count: globalCount, error: globalError } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('deleted_by_admin', false)
        .gt('created_at', readState.global_last_read_at)
        .neq('user_id', user.id); // No contar mis propios mensajes

      if (globalError) console.error('Error counting global messages:', globalError);

      // Contar mensajes de emergencia no leídos
      const { count: emergencyCount, error: emergencyError } = await supabase
        .from('emergency_messages')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', readState.emergency_last_read_at)
        .neq('user_id', user.id); // No contar mis propios mensajes

      if (emergencyError) console.error('Error counting emergency messages:', emergencyError);

      // Contar solicitudes de amistad pendientes
      const { count: friendsCount, error: friendsError } = await supabase
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .eq('addressee_id', user.id)
        .eq('status', 'pending');

      if (friendsError) console.error('Error counting friend requests:', friendsError);

      const g = globalCount || 0;
      const e = emergencyCount || 0;
      const f = friendsCount || 0;

      setCounts({
        global: g,
        emergency: e,
        friends: f,
        total: g + e + f,
      });
    } catch (error) {
      console.error('Error in useUnreadCount:', error);
    }
  }, [user]);

  // Marcar chat global como leído
  const markGlobalAsRead = useCallback(async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('chat_read_state')
        .upsert(
          { user_id: user.id, global_last_read_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );

      if (error) console.error('Error marking global as read:', error);
      else {
        setCounts(prev => ({ ...prev, global: 0, total: prev.emergency + prev.friends }));
      }
    } catch (error) {
      console.error('Error in markGlobalAsRead:', error);
    }
  }, [user]);

  // Marcar chat de emergencia como leído
  const markEmergencyAsRead = useCallback(async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('chat_read_state')
        .upsert(
          { user_id: user.id, emergency_last_read_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );

      if (error) console.error('Error marking emergency as read:', error);
      else {
        setCounts(prev => ({ ...prev, emergency: 0, total: prev.global + prev.friends }));
      }
    } catch (error) {
      console.error('Error in markEmergencyAsRead:', error);
    }
  }, [user]);

  // Cargar conteos iniciales
  useEffect(() => {
    fetchUnreadCounts();
  }, [fetchUnreadCounts]);

  // Suscribirse a nuevos mensajes para actualizar conteos en tiempo real
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('unread-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          // Solo actualizar si el mensaje no es mío
          if (payload.new && payload.new.user_id !== user.id) {
            fetchUnreadCounts();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'emergency_messages' },
        (payload) => {
          // Solo actualizar si el mensaje no es mío
          if (payload.new && payload.new.user_id !== user.id) {
            fetchUnreadCounts();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => {
          // Refresh counts on any friendship change (request, accept, block)
          fetchUnreadCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchUnreadCounts]);

  // Sync native badge whenever total changes
  useEffect(() => {
    syncNativeBadge(counts.total);
  }, [counts.total]);

  return {
    counts,
    fetchUnreadCounts,
    markGlobalAsRead,
    markEmergencyAsRead,
  };
}