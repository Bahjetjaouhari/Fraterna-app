-- Migration: Fix SECURITY DEFINER on public functions
-- Applied: 2026-04-22
-- 
-- Functions can_view_location and cleanup_expired_chat_messages were INVOKER,
-- which could cause RLS permission failures when called via RPC by authenticated users.

ALTER FUNCTION public.can_view_location(uuid, uuid) SECURITY DEFINER;
ALTER FUNCTION public.cleanup_expired_chat_messages() SECURITY DEFINER;
