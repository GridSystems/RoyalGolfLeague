-- Royal Golf Club — Phase 2 release B1 EMERGENCY ROLLBACK. Puts back everything phase2b_enforce.sql
-- removed, from what it saved in schema phase2b_backup: the anon_all policies, every grant to anon
-- (tables, columns, sequences, functions, the PIN functions), schema private's ACL and postgres's
-- default privileges. The gate goes back to 3. The public key can then read and edit everything again.
-- Redeploy app version 3 only if the PIN login itself is needed back. Version 4 runs fine on a
-- rolled-back database.
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). phase2b_enforce.sql can be run again
-- afterwards.
BEGIN;
DO $$ BEGIN
  IF to_regnamespace('phase2b_backup') IS NULL THEN
    RAISE EXCEPTION 'Nothing to roll back: schema phase2b_backup does not exist (phase2b_enforce.sql was never run, or was already rolled back).';
  END IF;
END $$;

DO $$ DECLARE r record; BEGIN
  -- Policies, exactly as they were.
  FOR r IN SELECT def FROM phase2b_backup.anon_policies LOOP EXECUTE r.def; END LOOP;
  -- Tables, columns, sequences. Column grants were column-level and go back column-level.
  FOR r IN SELECT * FROM phase2b_backup.anon_table_grants LOOP
    EXECUTE format('GRANT %s ON public.%I TO anon', r.privilege_type, r.table_name);
  END LOOP;
  FOR r IN SELECT * FROM phase2b_backup.anon_column_grants LOOP
    EXECUTE format('GRANT %s (%I) ON public.%I TO anon', r.privilege_type, r.column_name, r.table_name);
  END LOOP;
  FOR r IN SELECT * FROM phase2b_backup.anon_sequence_grants LOOP
    EXECUTE format('GRANT %s ON SEQUENCE public.%I TO anon', r.privilege_type, r.sequence_name);
  END LOOP;
  -- Functions, PIN functions included, to the grantee they had (anon, authenticated or PUBLIC).
  FOR r IN SELECT * FROM phase2b_backup.anon_function_grants LOOP
    EXECUTE format('GRANT %s ON FUNCTION %s TO %s', r.privilege_type, r.signature,
      CASE WHEN r.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r.grantee) END);
  END LOOP;
  -- Schema private: every entry of its ACL as it was (B1 only removed entries).
  FOR r IN SELECT a.* FROM phase2b_backup.private_schema_acl b, aclexplode(b.nspacl) a LOOP
    EXECUTE format('GRANT %s ON SCHEMA private TO %s%s', r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.grantee::regrole::text) END,
      CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $$;

-- Default privileges of postgres, global and in public. pg_default_acl can't be written directly, so
-- each row is brought to its backed-up ACL with ALTER DEFAULT PRIVILEGES: revoke every entry it has
-- now, grant every entry it had. A row with no backup did not exist before B1; its target is "no row",
-- which is the built-in default for a global row (e.g. PUBLIC EXECUTE on functions) and empty for a
-- per-schema one. Postgres deletes a row once its ACL equals that.
DO $$ DECLARE k record; e record; objs text; scope text; dflt aclitem[]; BEGIN
  FOR k IN
    WITH cur AS (
      SELECT n.nspname, d.defaclobjtype AS objtype, d.defaclacl AS acl FROM pg_default_acl d
        LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
       WHERE d.defaclrole = 'postgres'::regrole AND (d.defaclnamespace = 0 OR n.nspname = 'public'))
    SELECT coalesce(c.nspname, b.nspname) AS nspname, coalesce(c.objtype, b.defaclobjtype) AS objtype,
           c.acl AS cur, b.defaclacl AS tgt, (c.objtype IS NOT NULL) AS has_cur, (b.defaclobjtype IS NOT NULL) AS has_tgt
      FROM cur c FULL JOIN phase2b_backup.default_acl b
        ON c.nspname IS NOT DISTINCT FROM b.nspname AND c.objtype = b.defaclobjtype
  LOOP
    objs := CASE k.objtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
                           WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END;
    scope := CASE WHEN k.nspname IS NULL THEN '' ELSE format(' IN SCHEMA %I', k.nspname) END;
    dflt := CASE WHEN k.nspname IS NULL
                 THEN acldefault(CASE k.objtype WHEN 'S' THEN 's' ELSE k.objtype END, 'postgres'::regrole::oid)
                 ELSE '{}'::aclitem[] END;
    FOR e IN SELECT * FROM aclexplode(CASE WHEN k.has_cur THEN k.cur ELSE dflt END) LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres%s REVOKE %s ON %s FROM %s', scope, e.privilege_type, objs,
        CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(e.grantee::regrole::text) END);
    END LOOP;
    FOR e IN SELECT * FROM aclexplode(CASE WHEN k.has_tgt THEN k.tgt ELSE dflt END) LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres%s GRANT %s ON %s TO %s%s', scope, e.privilege_type, objs,
        CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(e.grantee::regrole::text) END,
        CASE WHEN e.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;
  END LOOP;
END $$;

-- Version gate back to release A's 3.
CREATE OR REPLACE FUNCTION public.require_current_app() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text := current_setting('request.headers', true)::json ->> 'x-app-version';
BEGIN
  IF current_user = 'service_role' THEN RETURN; END IF;
  IF coalesce(v, '') !~ '^\d+$' OR v::int < 3 THEN
    RAISE SQLSTATE 'PT426' USING MESSAGE = 'This version of the app is out of date. Please reload the page.';
  END IF;
END $fn$;

DROP TABLE IF EXISTS private.phase2b_report;
DROP SCHEMA phase2b_backup CASCADE;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
COMMIT;
