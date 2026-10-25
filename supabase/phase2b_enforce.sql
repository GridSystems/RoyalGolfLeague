-- Royal Golf Club — Phase 2 release B1: close the public key
-- Release A (phase2a_auth.sql) left an allow-all `anon_all` policy on every table so the old PIN
-- login kept working. Anyone with the public key (it is in the page) could read and edit everything.
-- This drops those policies and every grant to anon: tables, columns, sequences, functions (all but
-- the version gate), schema private, and the defaults for objects created later. The PIN functions
-- go dark for everyone. Logged-in members (authenticated) are unchanged.
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). REHEARSAL FIRST: with the switch on
-- `true` the script does everything, then fails on purpose with the report — which undoes it all.
-- Push app version 4 at least 10 minutes BEFORE the real run (GitHub Pages cache), then run it with
-- `false`: the gate refuses version 3 from here.
-- Rollback: phase2b_rollback.sql (restores from schema phase2b_backup).

BEGIN;
CREATE TEMP TABLE p2b_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH
CREATE TEMP TABLE p2b_report (ord serial, line text) ON COMMIT DROP;

-- ===== SECTION 1: preconditions ===========================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name='user_id') THEN
    RAISE EXCEPTION 'Run phase2a_auth.sql first. Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='players' AND policyname='anon_all') THEN
    RAISE EXCEPTION 'Phase 2 release B has already been applied (no anon_all policies left). Nothing was changed.';
  END IF;
END $$;

-- ===== SECTION 2: back up what the rollback restores ======================================
CREATE SCHEMA IF NOT EXISTS phase2b_backup;
REVOKE ALL ON SCHEMA phase2b_backup FROM PUBLIC, anon, authenticated;
DROP TABLE IF EXISTS phase2b_backup.anon_policies, phase2b_backup.anon_table_grants, phase2b_backup.anon_column_grants,
  phase2b_backup.anon_function_grants, phase2b_backup.anon_sequence_grants;
CREATE TABLE phase2b_backup.anon_policies AS
  SELECT tablename, format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s', policyname, tablename,
           permissive, cmd, (SELECT string_agg(quote_ident(r), ', ') FROM unnest(roles) r),
           ' USING (' || qual || ')', ' WITH CHECK (' || with_check || ')') AS def
  FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_all';
CREATE TABLE phase2b_backup.anon_table_grants AS
  SELECT DISTINCT table_name, privilege_type FROM information_schema.role_table_grants
   WHERE grantee = 'anon' AND table_schema = 'public';
-- column_privileges also lists the columns a table-level grant covers; keep only real column grants.
CREATE TABLE phase2b_backup.anon_column_grants AS
  SELECT DISTINCT c.table_name, c.column_name, c.privilege_type FROM information_schema.role_column_grants c
   WHERE c.grantee = 'anon' AND c.table_schema = 'public'
     AND NOT EXISTS (SELECT 1 FROM phase2b_backup.anon_table_grants t WHERE t.table_name = c.table_name AND t.privilege_type = c.privilege_type);
CREATE TABLE phase2b_backup.anon_function_grants AS
  SELECT DISTINCT rp.grantee, p.oid::regprocedure::text AS signature, rp.privilege_type
    FROM information_schema.routine_privileges rp
    JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace AND p.proname || '_' || p.oid = rp.specific_name
   WHERE rp.grantee IN ('anon', 'PUBLIC') AND rp.specific_schema = 'public';
CREATE TABLE phase2b_backup.anon_sequence_grants AS
  SELECT DISTINCT object_name AS sequence_name, privilege_type FROM information_schema.usage_privileges
   WHERE object_type = 'SEQUENCE' AND grantee = 'anon' AND object_schema = 'public';
DO $$ BEGIN
  INSERT INTO p2b_report(line) VALUES ('backed up: ' ||
    (SELECT count(*) FROM phase2b_backup.anon_policies) || ' anon_all policies, ' ||
    (SELECT count(*) FROM phase2b_backup.anon_table_grants) || ' table grants, ' ||
    (SELECT count(*) FROM phase2b_backup.anon_column_grants) || ' column grants, ' ||
    (SELECT count(*) FROM phase2b_backup.anon_function_grants) || ' function grants, ' ||
    (SELECT count(*) FROM phase2b_backup.anon_sequence_grants) || ' sequence grants');
END $$;

-- ===== SECTION 3: tables and sequences =====================================================
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM phase2b_backup.anon_policies LOOP
    EXECUTE format('DROP POLICY anon_all ON public.%I', t);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;   -- also removes column grants (players.user_id, …)
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ===== SECTION 4: functions ===============================================================
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_current_app() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_draw(text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_signup(text, text, numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_member_emails() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_mode() TO authenticated;
-- The PIN route is retired: nobody calls these any more, whatever their signature.
DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('login', 'has_pin', 'check_pin', 'set_first_pin', 'admin_reset_pin', '_check_pin') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

-- ===== SECTION 5: schema private ==========================================================
-- Policies use private.* only for authenticated; email linking runs as a SECURITY DEFINER trigger.
REVOKE USAGE ON SCHEMA private FROM anon;

-- ===== SECTION 6: objects created later in the SQL editor =================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon;
-- EXECUTE for PUBLIC is Postgres's built-in global default, and a per-schema revoke can't remove a
-- global grant, so it goes globally. Logged-in users keep Supabase's per-schema grant on public;
-- a new function in another schema (private) needs its own GRANT, as every migration already gives.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ===== SECTION 7: version gate — this release is version 4 ================================
CREATE OR REPLACE FUNCTION public.require_current_app() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text := current_setting('request.headers', true)::json ->> 'x-app-version';
BEGIN
  IF current_user = 'service_role' THEN RETURN; END IF;
  IF coalesce(v, '') !~ '^\d+$' OR v::int < 4 THEN
    RAISE SQLSTATE 'PT426' USING MESSAGE = 'This version of the app is out of date. Please reload the page.';
  END IF;
END $fn$;

-- ===== CHECKS =============================================================================
DO $$ DECLARE bad text; BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname) INTO bad
    FROM pg_policies WHERE schemaname = 'public' AND ('anon' = ANY(roles) OR 'public' = ANY(roles));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Policies still open to anon/public: %', bad; END IF;
END $$;

DO $$ DECLARE bad text; n int; BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
          OR has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon can still use table(s): %', bad; END IF;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace   -- CASE: has_sequence_privilege errors on a table, and WHERE order isn't guaranteed
     AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon can still use sequence(s): %', bad; END IF;
  SELECT count(*) INTO n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f');
  INSERT INTO p2b_report(line) VALUES ('tables closed to anon: ' || n);
END $$;

DO $$ DECLARE bad text; n int; BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO bad FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'require_current_app'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon can still call function(s): %', bad; END IF;
  SELECT count(*) INTO n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'require_current_app';
  INSERT INTO p2b_report(line) VALUES ('functions closed to anon: ' || n);
END $$;

DO $$ BEGIN
  INSERT INTO p2b_report(line) VALUES ('version gate: requests need x-app-version >= 4');
END $$;

DO $$ BEGIN
  INSERT INTO p2b_report(line) VALUES ('ALL CHECKS PASSED');
END $$;

DO $$ BEGIN
  IF (SELECT rehearsal FROM p2b_mode) THEN
    RAISE EXCEPTION E'REHEARSAL OK — everything was rolled back. Report:\n%', (SELECT string_agg(line, E'\n' ORDER BY ord) FROM p2b_report);
  END IF;
END $$;
DROP TABLE IF EXISTS private.phase2b_report;
CREATE TABLE private.phase2b_report AS SELECT ord, line FROM p2b_report;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
COMMIT;
SELECT line FROM private.phase2b_report ORDER BY ord;
