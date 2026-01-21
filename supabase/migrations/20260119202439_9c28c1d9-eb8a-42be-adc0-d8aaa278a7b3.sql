-- =============================================
-- FRATERNA DATABASE SCHEMA
-- =============================================

-- 1. Create enum for roles
CREATE TYPE public.app_role AS ENUM ('user', 'admin', 'ceo');

-- 2. Create enum for verification status
CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'blocked', 'manual_review');

-- 3. Create enum for message type
CREATE TYPE public.message_type AS ENUM ('text', 'voice');

-- 4. Create enum for report status
CREATE TYPE public.report_status AS ENUM ('open', 'in_review', 'resolved');

-- 5. Create enum for ticket status
CREATE TYPE public.ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- =============================================
-- BASE TABLES
-- =============================================

-- Profiles table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Venezuela',
    city TEXT NOT NULL,
    lodge TEXT NOT NULL,
    phone TEXT,
    email TEXT NOT NULL,
    photo_url TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verification_status public.verification_status NOT NULL DEFAULT 'pending',
    tracking_enabled BOOLEAN NOT NULL DEFAULT true,
    stealth_mode BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles table (separate for security)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role public.app_role NOT NULL DEFAULT 'user',
    granted_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Locations table
CREATE TABLE public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy_meters INTEGER NOT NULL DEFAULT 200 CHECK (accuracy_meters >= 100 AND accuracy_meters <= 300),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Verification attempts table
CREATE TABLE public.verification_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chat messages table
CREATE TABLE public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type public.message_type NOT NULL DEFAULT 'text',
    text TEXT,
    voice_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
    deleted_by_admin BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT valid_message CHECK (
        (type = 'text' AND text IS NOT NULL) OR 
        (type = 'voice' AND voice_url IS NOT NULL)
    )
);

-- Reports table
CREATE TABLE public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    details TEXT,
    status public.report_status NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tickets table
CREATE TABLE public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status public.ticket_status NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- SECURITY DEFINER FUNCTIONS (bypass RLS)
-- =============================================

-- Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
        AND role = _role
    )
$$;

-- Check if user is admin or ceo
CREATE OR REPLACE FUNCTION public.is_admin_or_ceo(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
        AND role IN ('admin', 'ceo')
    )
$$;

-- Check if user is verified
CREATE OR REPLACE FUNCTION public.is_user_verified(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = _user_id
        AND is_verified = true
    )
$$;

-- =============================================
-- TRIGGERS
-- =============================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reports_updated_at
    BEFORE UPDATE ON public.reports
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tickets_updated_at
    BEFORE UPDATE ON public.tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_locations_updated_at
    BEFORE UPDATE ON public.locations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, city, lodge)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Nuevo Hermano'),
        COALESCE(NEW.raw_user_meta_data->>'city', 'Sin especificar'),
        COALESCE(NEW.raw_user_meta_data->>'lodge', 'Sin especificar')
    );
    
    -- Create default user role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    -- Create verification attempts record
    INSERT INTO public.verification_attempts (user_id)
    VALUES (NEW.id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- ENABLE RLS
-- =============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES - PROFILES
-- =============================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- Verified users can view other verified profiles
CREATE POLICY "Verified users can view verified profiles"
    ON public.profiles FOR SELECT
    USING (
        public.is_user_verified(auth.uid()) 
        AND is_verified = true
    );

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT
    USING (public.is_admin_or_ceo(auth.uid()));

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Admins can update any profile
CREATE POLICY "Admins can update any profile"
    ON public.profiles FOR UPDATE
    USING (public.is_admin_or_ceo(auth.uid()));

-- =============================================
-- RLS POLICIES - USER ROLES
-- =============================================

-- Users can view their own roles
CREATE POLICY "Users can view own roles"
    ON public.user_roles FOR SELECT
    USING (auth.uid() = user_id);

-- Admins can view all roles
CREATE POLICY "Admins can view all roles"
    ON public.user_roles FOR SELECT
    USING (public.is_admin_or_ceo(auth.uid()));

-- Only admins/ceo can manage roles
CREATE POLICY "Admins can insert roles"
    ON public.user_roles FOR INSERT
    WITH CHECK (public.is_admin_or_ceo(auth.uid()));

CREATE POLICY "Admins can update roles"
    ON public.user_roles FOR UPDATE
    USING (public.is_admin_or_ceo(auth.uid()));

CREATE POLICY "Admins can delete roles"
    ON public.user_roles FOR DELETE
    USING (public.is_admin_or_ceo(auth.uid()));

-- =============================================
-- RLS POLICIES - LOCATIONS
-- =============================================

-- Users can view their own location
CREATE POLICY "Users can view own location"
    ON public.locations FOR SELECT
    USING (auth.uid() = user_id);

-- Verified users can view other verified users' locations
CREATE POLICY "Verified users can view verified locations"
    ON public.locations FOR SELECT
    USING (
        public.is_user_verified(auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = locations.user_id
            AND p.is_verified = true
            AND p.stealth_mode = false
            AND p.tracking_enabled = true
        )
    );

-- Admins can view all locations
CREATE POLICY "Admins can view all locations"
    ON public.locations FOR SELECT
    USING (public.is_admin_or_ceo(auth.uid()));

-- Users can insert their own location
CREATE POLICY "Users can insert own location"
    ON public.locations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own location
CREATE POLICY "Users can update own location"
    ON public.locations FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- =============================================
-- RLS POLICIES - VERIFICATION ATTEMPTS
-- =============================================

-- Users can view their own attempts
CREATE POLICY "Users can view own verification attempts"
    ON public.verification_attempts FOR SELECT
    USING (auth.uid() = user_id);

-- Admins can view all attempts
CREATE POLICY "Admins can view all verification attempts"
    ON public.verification_attempts FOR SELECT
    USING (public.is_admin_or_ceo(auth.uid()));

-- Users can update their own attempts
CREATE POLICY "Users can update own verification attempts"
    ON public.verification_attempts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can update any attempts
CREATE POLICY "Admins can update any verification attempts"
    ON public.verification_attempts FOR UPDATE
    USING (public.is_admin_or_ceo(auth.uid()));

-- =============================================
-- RLS POLICIES - CHAT MESSAGES
-- =============================================

-- Verified users and admins can view non-deleted, non-expired messages
CREATE POLICY "Verified users can view chat messages"
    ON public.chat_messages FOR SELECT
    USING (
        (public.is_user_verified(auth.uid()) OR public.is_admin_or_ceo(auth.uid()))
        AND deleted_by_admin = false
        AND expires_at > now()
    );

-- Only verified users can insert messages
CREATE POLICY "Verified users can insert chat messages"
    ON public.chat_messages FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND public.is_user_verified(auth.uid())
    );

-- Users can update their own messages (soft delete)
CREATE POLICY "Users can update own chat messages"
    ON public.chat_messages FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can update any message (for moderation)
CREATE POLICY "Admins can update any chat message"
    ON public.chat_messages FOR UPDATE
    USING (public.is_admin_or_ceo(auth.uid()));

-- Only admins can delete messages
CREATE POLICY "Admins can delete chat messages"
    ON public.chat_messages FOR DELETE
    USING (public.is_admin_or_ceo(auth.uid()));

-- =============================================
-- RLS POLICIES - REPORTS
-- =============================================

-- Users can view their own reports
CREATE POLICY "Users can view own reports"
    ON public.reports FOR SELECT
    USING (auth.uid() = reporter_id);

-- Admins can view all reports
CREATE POLICY "Admins can view all reports"
    ON public.reports FOR SELECT
    USING (public.is_admin_or_ceo(auth.uid()));

-- Verified users can create reports
CREATE POLICY "Verified users can create reports"
    ON public.reports FOR INSERT
    WITH CHECK (
        auth.uid() = reporter_id
        AND public.is_user_verified(auth.uid())
    );

-- Admins can update reports
CREATE POLICY "Admins can update reports"
    ON public.reports FOR UPDATE
    USING (public.is_admin_or_ceo(auth.uid()));

-- =============================================
-- RLS POLICIES - TICKETS
-- =============================================

-- Users can view their own tickets
CREATE POLICY "Users can view own tickets"
    ON public.tickets FOR SELECT
    USING (auth.uid() = user_id);

-- Admins can view all tickets
CREATE POLICY "Admins can view all tickets"
    ON public.tickets FOR SELECT
    USING (public.is_admin_or_ceo(auth.uid()));

-- Any authenticated user can create tickets
CREATE POLICY "Users can create tickets"
    ON public.tickets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own tickets
CREATE POLICY "Users can update own tickets"
    ON public.tickets FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can update any ticket
CREATE POLICY "Admins can update any ticket"
    ON public.tickets FOR UPDATE
    USING (public.is_admin_or_ceo(auth.uid()));

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_profiles_verification_status ON public.profiles(verification_status);
CREATE INDEX idx_profiles_is_verified ON public.profiles(is_verified);
CREATE INDEX idx_locations_user_id ON public.locations(user_id);
CREATE INDEX idx_locations_coords ON public.locations(lat, lng);
CREATE INDEX idx_chat_messages_expires_at ON public.chat_messages(expires_at);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);
CREATE INDEX idx_reports_status ON public.reports(status);
CREATE INDEX idx_tickets_status ON public.tickets(status);

-- =============================================
-- REALTIME
-- =============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.locations;