-- Crear la tabla de auditoría para moderadores y administradores
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    admin_id uuid,
    target_user_id uuid,
    action text NOT NULL,
    metadata jsonb,
    CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.admin_audit_logs IS 'Registro inmutable de las acciones realizadas por los administradores (ban, unban, grant, revoke).';

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Solo los administradores pueden leer el registro de auditoría
CREATE POLICY "Admins can view audit logs"
    ON public.admin_audit_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles 
            WHERE user_roles.user_id = auth.uid() 
            AND user_roles.role IN ('admin', 'ceo')
        )
    );

-- Nota: No se agregan políticas de INSERT/UPDATE/DELETE. 
-- La inserción la harán únicamente las Edge Functions usando el Service Role Key (que hace bypass del RLS),
-- asegurando así que el historial sea completamente inmutable desde el frontend web.
