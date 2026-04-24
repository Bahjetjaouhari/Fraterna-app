-- Migration: Fix SECURITY DEFINER on heartbeat and online status functions
-- Applied: 2026-04-24
--
-- Functions is_user_active, get_online_users_count, get_online_users_count_by_city
-- were INVOKER, which could cause RLS permission failures when called via RPC
-- by authenticated users whose RLS policies restrict SELECT on profiles.

ALTER FUNCTION public.is_user_active(uuid) SECURITY DEFINER;
ALTER FUNCTION public.get_online_users_count() SECURITY DEFINER;
ALTER FUNCTION public.get_online_users_count_by_city(text) SECURITY DEFINER;

-- Also check if get_online_users exists and apply SECURITY DEFINER
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_online_users' AND pronamespace = 'public'::regnamespace) THEN
        EXECUTE 'ALTER FUNCTION public.get_online_users() SECURITY DEFINER';
    END IF;
END
$$;