-- Royal Golf Club — permission check. Read-only: changes nothing, safe to run any time.
-- Run in the Supabase SQL Editor after every database change (security review SEC-06). It checks
-- the permissions as they actually are, not that some script ran:
--   every public table has row level security on; no rule is open to anon/public; no rule is a
--   plain allow-all (true); anon can't use any table, sequence or function (bar the version gate)
--   or schema private; players.email is readable by no API role; members can't call the audit
--   writer or write audit_log; rounds keeps exactly its three write rules and two triggers
--   (round_rules.sql) — permissive rules OR together, so one extra would undo them.
-- Passes: one row, ALL CHECKS PASSED. Fails: an error listing every problem found.
BEGIN READ ONLY;
DO $$ DECLARE problems text[] := '{}'; bad text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF bad IS NOT NULL THEN problems := problems || ('row level security off: ' || bad); END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname) INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND ('anon' = ANY(roles) OR 'public' = ANY(roles));
  IF bad IS NOT NULL THEN problems := problems || ('rules open to anon/public: ' || bad); END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname) INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND (qual = 'true' OR with_check = 'true');
  IF bad IS NOT NULL THEN problems := problems || ('allow-all (true) rules: ' || bad); END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'));
  IF bad IS NOT NULL THEN problems := problems || ('anon can use table(s): ' || bad); END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END;
  IF bad IS NOT NULL THEN problems := problems || ('anon can use sequence(s): ' || bad); END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO bad FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'require_current_app'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN problems := problems || ('anon can call: ' || bad); END IF;

  IF has_schema_privilege('anon', 'private', 'USAGE') THEN problems := problems || 'anon has USAGE on schema private'::text; END IF;

  SELECT string_agg(r, ', ') INTO bad FROM unnest(ARRAY['anon', 'authenticated']) r
   WHERE has_column_privilege(r, 'public.players', 'email', 'SELECT');
  IF bad IS NOT NULL THEN problems := problems || ('players.email readable by: ' || bad); END IF;

  SELECT string_agg(r, ', ') INTO bad FROM unnest(ARRAY['anon', 'authenticated']) r
   WHERE has_function_privilege(r, 'private.audit(text, bigint, jsonb, bigint)', 'EXECUTE');
  IF bad IS NOT NULL THEN problems := problems || ('private.audit callable by: ' || bad); END IF;

  IF has_table_privilege('authenticated', 'public.audit_log', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    problems := problems || 'members can write audit_log'::text; END IF;

  SELECT string_agg(policyname || ' (' || cmd || ')', ', ' ORDER BY policyname) INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'rounds' AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT'
     AND policyname NOT IN ('p2_rounds_write', 'p2_rounds_upd', 'p2_rounds_del');
  IF bad IS NOT NULL THEN problems := problems || ('other write rules on rounds: ' || bad); END IF;

  SELECT string_agg(t, ', ') INTO bad FROM unnest(ARRAY['p2_rounds_write', 'p2_rounds_upd', 'p2_rounds_del']) t
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rounds' AND policyname = t);
  IF bad IS NOT NULL THEN problems := problems || ('rules missing on rounds (run round_rules.sql): ' || bad); END IF;

  SELECT string_agg(t, ', ') INTO bad FROM unnest(ARRAY['protect_round_fields', 'audit_rounds']) t
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rounds'::regclass AND tgname = t AND tgenabled <> 'D');
  IF bad IS NOT NULL THEN problems := problems || ('triggers missing on rounds: ' || bad); END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION E'PERMISSION CHECK FAILED — % problem(s):\n- %', cardinality(problems), array_to_string(problems, E'\n- ');
  END IF;
END $$;
SELECT 'ALL CHECKS PASSED' AS result;
COMMIT;
