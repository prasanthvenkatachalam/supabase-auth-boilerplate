-- Schema pulled from Supabase via MCP (list_migrations + list_tables + execute_sql).
-- Represents the current database state. Supabase does not store migration SQL bodies,
-- so this file is generated from live schema introspection.
-- Generated for sync with project folder.

-- =============================================================================
-- TABLE: public.profiles
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  phone text,
  email_verified boolean DEFAULT false,
  last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT profiles_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text),
  CONSTRAINT profiles_email_key UNIQUE (email)
);

COMMENT ON TABLE public.profiles IS 'User profiles linked to auth.users';

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS POLICIES: public.profiles
-- =============================================================================
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- =============================================================================
-- FUNCTIONS (current and legacy; some legacy reference dropped tables)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_email_verified_only_by_backend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (OLD.email_verified IS NOT TRUE AND NEW.email_verified = true)
     AND current_user NOT IN ('postgres', 'service_role')
  THEN
    RAISE EXCEPTION 'email_verified can only be set by the application after verification';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_profile_email_verified(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles
  SET email_verified = true,
      updated_at = now()
  WHERE id = target_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_profile_email_verified_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles
  SET email_verified = (NEW.email_confirmed_at IS NOT NULL),
      updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

-- =============================================================================
-- TRIGGERS: public.profiles
-- =============================================================================
DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS check_email_verified_trigger ON public.profiles;
CREATE TRIGGER check_email_verified_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (old.email_verified IS DISTINCT FROM new.email_verified AND new.email_verified = true)
  EXECUTE FUNCTION public.check_email_verified_only_by_backend();

-- =============================================================================
-- TRIGGER ON auth.users (sync email_verified from auth to profiles)
-- =============================================================================
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed_at_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed_at_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (old.email_confirmed_at IS DISTINCT FROM new.email_confirmed_at)
  EXECUTE FUNCTION public.sync_profile_email_verified_from_auth();
