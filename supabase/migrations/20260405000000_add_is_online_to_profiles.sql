-- =====================================================
-- MIGRACIÓN: Agregar campo is_online a profiles
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- 1. Agregar columna is_online a la tabla profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;

-- 2. Crear índice para consultas más rápidas
CREATE INDEX IF NOT EXISTS profiles_is_online_idx
ON public.profiles(is_online)
WHERE is_online = true;

-- 3. Comentario descriptivo
COMMENT ON COLUMN public.profiles.is_online IS
'True cuando el usuario tiene sesión activa (logueado), false cuando cerró sesión manualmente. A diferencia de last_seen_at, este campo no expira automáticamente.';

-- 4. Actualizar usuarios existentes como offline (por defecto ya están en false)
-- Los usuarios se marcarán como online cuando vuelvan a iniciar sesión

-- =====================================================
-- VERIFICACIÓN: Ejecutar esta query para confirmar
-- =====================================================
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_online';