-- Sync public.profiles.email_verified from auth.users.email_confirmed_at.
-- When Supabase Auth sets email_confirmed_at (e.g. after email verification),
-- this trigger updates the profile so the app has a single source of truth from auth.

CREATE OR REPLACE FUNCTION public.sync_profile_email_verified_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email_verified = (NEW.email_confirmed_at IS NOT NULL),
      updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed_at_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed_at_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  EXECUTE FUNCTION public.sync_profile_email_verified_from_auth();
