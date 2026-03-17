-- Secure email_verified updates: only the backend can set profiles.email_verified to true.
-- 1) RPC that only service_role/postgres can call (used by API after verifying token).
-- 2) Trigger that blocks direct UPDATEs setting email_verified to true from other roles.

-- Function: set_profile_email_verified(target_id uuid)
-- Called only from API routes after Supabase auth.verifyOtp/exchangeCodeForSession succeeds.
CREATE OR REPLACE FUNCTION public.set_profile_email_verified(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email_verified = true,
      updated_at = now()
  WHERE id = target_id;
END;
$$;

-- Only backend (service role) and postgres can call this; anon/authenticated cannot.
REVOKE EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_profile_email_verified(uuid) TO service_role;

-- Trigger: block any direct UPDATE that sets email_verified to true unless from trusted role.
-- Trusted roles: postgres (function runs as definer), service_role (API with service key).
CREATE OR REPLACE FUNCTION public.check_email_verified_only_by_backend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.email_verified IS NOT TRUE AND NEW.email_verified = true)
     AND current_user NOT IN ('postgres', 'service_role')
  THEN
    RAISE EXCEPTION 'email_verified can only be set by the application after verification';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_email_verified_trigger ON public.profiles;
CREATE TRIGGER check_email_verified_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.email_verified IS DISTINCT FROM NEW.email_verified AND NEW.email_verified = true)
  EXECUTE FUNCTION public.check_email_verified_only_by_backend();
