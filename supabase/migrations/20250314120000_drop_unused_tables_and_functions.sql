-- Drop unused tables and their dependent functions.
-- Keeps only the profiles table for auth (email_verified updated on verification).
-- Run in Supabase Dashboard → SQL Editor if not using Supabase CLI.

-- Drop functions that reference the tables being removed (order may matter for dependencies)
DROP FUNCTION IF EXISTS public.cleanup_expired_sessions();
DROP FUNCTION IF EXISTS public.cleanup_expired_verifications();
DROP FUNCTION IF EXISTS public.get_active_session_count(uuid);
DROP FUNCTION IF EXISTS public.get_active_session_count(text);
DROP FUNCTION IF EXISTS public.increment_verification_attempts(text);
DROP FUNCTION IF EXISTS public.is_email_verified();
DROP FUNCTION IF EXISTS public.log_security_event(text, text, unknown, text, jsonb);
DROP FUNCTION IF EXISTS public.log_security_event(text, text);
DROP FUNCTION IF EXISTS public.revoke_all_sessions_except(text, uuid);
DROP FUNCTION IF EXISTS public.revoke_all_sessions_except(text, text);

-- Drop tables (no FKs between these three)
DROP TABLE IF EXISTS public.audit_logs;
DROP TABLE IF EXISTS public.email_verifications;
DROP TABLE IF EXISTS public.user_sessions;
