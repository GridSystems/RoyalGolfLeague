-- Royal Golf Club — Phase 2A EMERGENCY ROLLBACK. Removes release A's database objects and returns
-- the gate to 2. The audit log is dropped with it. Redeploy the previous app (git revert of the
-- Phase 2A merge) straight after. Logins created in Supabase Auth stay (harmless; unlinked).
BEGIN;
DROP TRIGGER IF EXISTS link_login ON auth.users;
DROP TRIGGER IF EXISTS audit_auth_users ON auth.users;
DROP TRIGGER IF EXISTS audit_mfa ON auth.mfa_factors;
DROP TRIGGER IF EXISTS protect_player_fields ON public.players;
DROP TRIGGER IF EXISTS audit_players ON public.players;
DROP TRIGGER IF EXISTS audit_payments ON public.fine_payments;
DROP TRIGGER IF EXISTS audit_fines ON public.fines;
DROP TRIGGER IF EXISTS protect_signup_fields ON public.saturday_signups;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'p2%' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS anon_all ON public.%I', r.tablename);
    EXECUTE format('CREATE POLICY anon_all ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', r.tablename);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.run_draw(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.admin_member_emails();
DROP FUNCTION IF EXISTS public.log_admin_mode();
DROP TABLE IF EXISTS public.audit_log;
ALTER TABLE public.players DROP COLUMN IF EXISTS user_id;
DROP SCHEMA IF EXISTS private CASCADE;
CREATE OR REPLACE FUNCTION public.require_current_app() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text := current_setting('request.headers', true)::json ->> 'x-app-version';
BEGIN
  IF current_user = 'service_role' THEN RETURN; END IF;
  IF coalesce(v, '') !~ '^\d+$' OR v::int < 2 THEN
    RAISE SQLSTATE 'PT426' USING MESSAGE = 'This version of the app is out of date. Please reload the page.';
  END IF;
END $fn$;
NOTIFY pgrst, 'reload schema';
COMMIT;
