import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface UnreadCounts {
  global: number;
  emergency: number;
  total: number;
}

/**
 * Hook para obtener el conteo de mensajes no leídos en cada chat
 */
export function useUnreadCount() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnreadCounts>({ global: 0, emergency: 0, total: 0 });

  const fetchUnreadCounts = useCallback(async () => {
    if (!user) {
      setCounts({ global: 0, emergency: 0, total: 0 });
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

      setCounts({
        global: globalCount || 0,
        emergency: emergencyCount || 0,
        total: (globalCount || 0) + (emergencyCount || 0),
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
        setCounts(prev => ({ ...prev, global: 0, total: prev.emergency }));
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
        setCounts(prev => ({ ...prev, emergency: 0, total: prev.global }));
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchUnreadCounts]);

  return {
    counts,
    fetchUnreadCounts,
    markGlobalAsRead,
    markEmergencyAsRead,
  };
}