-- Crear tabla de reportes
CREATE TABLE IF NOT EXISTS public.user_reports (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reported_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT user_reports_pkey PRIMARY KEY (id)
);

-- Habilitar RLS
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Politica 1: Cualquier usuario autenticado puede reportar (insertar)
CREATE POLICY "Users can create reports" 
ON public.user_reports 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = reporter_id);

-- Politica 2: Solo admins pueden leer todos los reportes
CREATE POLICY "Admins can view all reports" 
ON public.user_reports 
FOR SELECT 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()
    )
);

-- Politica 3: Solo admins pueden actualizar reportes (ej. cambiar status a rsuelto)
CREATE POLICY "Admins can update reports" 
ON public.user_reports 
FOR UPDATE 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid()
    )
);
