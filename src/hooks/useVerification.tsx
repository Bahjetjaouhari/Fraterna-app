import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface VerificationAttempt {
  id: string;
  user_id: string;
  attempt_count: number;
  locked_until: string | null;
  last_attempt_at: string | null;
}

export const useVerification = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [attempts, setAttempts] = useState<VerificationAttempt | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const maxAttempts = 3;

  useEffect(() => {
    if (user) {
      fetchAttempts();
    }
  }, [user]);

  const fetchAttempts = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('verification_attempts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching verification attempts:', error);
    } else {
      setAttempts(data as VerificationAttempt | null);
    }
    setIsLoading(false);
  };

  const isBlocked = () => {
    if (!attempts) return false;
    
    if (attempts.locked_until) {
      const lockTime = new Date(attempts.locked_until);
      return lockTime > new Date();
    }
    
    return attempts.attempt_count >= maxAttempts;
  };

  const getRemainingAttempts = () => {
    if (!attempts) return maxAttempts;
    return Math.max(0, maxAttempts - attempts.attempt_count);
  };

  const recordFailedAttempt = async () => {
    if (!user || !attempts) return false;

    const newAttemptCount = attempts.attempt_count + 1;
    const shouldBlock = newAttemptCount >= maxAttempts;

    const { error } = await supabase
      .from('verification_attempts')
      .update({
        attempt_count: newAttemptCount,
        last_attempt_at: new Date().toISOString(),
        locked_until: shouldBlock 
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // Lock for 1 year (until manual review)
          : null,
      })
      .eq('user_id', user.id);

    if (error) {
      console.error('Error recording failed attempt:', error);
      return false;
    }

    // Update profile to manual_review if blocked
    if (shouldBlock) {
      await supabase
        .from('profiles')
        .update({ verification_status: 'manual_review' })
        .eq('id', user.id);
    }

    await fetchAttempts();
    return shouldBlock;
  };

  const recordSuccessfulVerification = async () => {
    if (!user) return false;

    const { error } = await supabase
      .from('profiles')
      .update({
        is_verified: true,
        verification_status: 'verified',
      })
      .eq('id', user.id);

    if (error) {
      console.error('Error updating verification status:', error);
      return false;
    }

    await refreshProfile();
    return true;
  };

  return {
    attempts,
    isLoading,
    isBlocked: isBlocked(),
    remainingAttempts: getRemainingAttempts(),
    recordFailedAttempt,
    recordSuccessfulVerification,
    fetchAttempts,
  };
};
