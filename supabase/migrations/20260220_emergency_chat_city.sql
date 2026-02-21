-- Migración: Chat de Emergencia Local
-- Añadir city + expires_at a emergency_messages

-- 1. Columna city (tomada del perfil al enviar)
ALTER TABLE emergency_messages
  ADD COLUMN IF NOT EXISTS city text;

-- 2. Columna expires_at (default 24h desde created_at)
ALTER TABLE emergency_messages
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
    DEFAULT (now() + interval '24 hours');

-- 3. Índice para filtrar por ciudad + no expirados (rendimiento)
CREATE INDEX IF NOT EXISTS idx_emergency_messages_city_expires
  ON emergency_messages (city, expires_at DESC);

-- 4. RLS: solo leer mensajes de tu misma ciudad (si city no es null)
-- Primero asegurar que RLS está activo
ALTER TABLE emergency_messages ENABLE ROW LEVEL SECURITY;

-- Política de lectura: ver TODO (el filtro de ciudad se hace en el frontend
-- para mayor flexibilidad — admins pueden ver todo)
CREATE POLICY IF NOT EXISTS "Users can read emergency messages"
  ON emergency_messages FOR SELECT
  TO authenticated
  USING (true);

-- Política de insertar: solo tu propio user_id
DROP POLICY IF EXISTS "Users can insert own emergency messages" ON emergency_messages;
CREATE POLICY "Users can insert own emergency messages"
  ON emergency_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
