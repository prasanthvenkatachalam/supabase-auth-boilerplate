-- Audit logs are not used. Drop any trigger/function that references public.audit_logs
-- so signup (and other flows) do not fail with "relation public.audit_logs does not exist".

-- Drop functions that reference audit_logs (CASCADE drops dependent triggers)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosrc LIKE '%audit_logs%'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I CASCADE', r.nspname, r.proname);
  END LOOP;
END $$;

-- Ensure table is gone (idempotent)
DROP TABLE IF EXISTS public.audit_logs;
