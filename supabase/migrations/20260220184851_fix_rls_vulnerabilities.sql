-- =============================================
-- FIX RLS VULNERABILITIES — Fraterna Lovable
-- Fecha: 2026-02-20
-- =============================================

-- 🔴 FIX #1: Eliminar la política que expone TODAS las ubicaciones
DROP POLICY IF EXISTS "locations_select_all_auth" ON public.locations;

-- Eliminar también la política antigua 'locations_read' que no usa is_user_active()
DROP POLICY IF EXISTS "locations_read" ON public.locations;

-- 🔴 FIX #2: Agregar política SELECT a admin_users (actualmente tiene 0 políticas)
CREATE POLICY "admin_users_select_own"
  ON public.admin_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 🟡 FIX #3: Eliminar políticas duplicadas sin is_user_active()
-- (las versiones con is_user_active() ya existen y quedarán como únicas)

-- chat_messages: eliminar INSERT sin verificación de activo
DROP POLICY IF EXISTS "chat_insert" ON public.chat_messages;

-- locations: eliminar INSERTs redundantes sin verificación de activo
DROP POLICY IF EXISTS "locations_insert_own" ON public.locations;
DROP POLICY IF EXISTS "locations_upsert_own" ON public.locations;
DROP POLICY IF EXISTS "locations_insert" ON public.locations;

-- locations: eliminar SELECT redundante sin verificación de activo
DROP POLICY IF EXISTS "locations_select_active" ON public.locations;

-- verification_attempts: eliminar las sin verificación de activo
DROP POLICY IF EXISTS "verification_attempts_insert_own" ON public.verification_attempts;
DROP POLICY IF EXISTS "verification_attempts_select_own" ON public.verification_attempts;
