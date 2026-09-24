-- Royal Golf Club — season entries (opt-in paid entry, Winter 2027 onwards).
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). REHEARSAL FIRST: with the switch on
-- (true) it runs everything, reports, then rolls back. Set it to false for the real run.
-- Needs phase2a_auth.sql (Phase 2 release A). Undo: season_entries_rollback.sql.
BEGIN;
CREATE TEMP TABLE se_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH
CREATE TEMP TABLE se_report (ord serial, line text) ON COMMIT DROP;

DO $$ BEGIN
  IF to_regclass('public.season_entries') IS NOT NULL THEN
    RAISE EXCEPTION 'season_entries already exists. Nothing was changed.';
  END IF;
  IF to_regprocedure('private.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'phase2a_auth.sql must be applied first. Nothing was changed.';
  END IF;
END $$;

-- One row per player per season. paid_at null = entered, awaiting payment.
CREATE TABLE public.season_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season text NOT NULL,
  player_id bigint NOT NULL REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  amount numeric,
  recorded_by bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (season, player_id)
);
ALTER TABLE public.season_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.season_entries TO anon, authenticated;

-- The old PIN route keeps allow-all until release B, as on every table.
CREATE POLICY anon_all ON public.season_entries FOR ALL TO anon USING (true) WITH CHECK (true);
-- Members: read all; enter themselves (unpaid); withdraw while unpaid. Admin mode: everything.
CREATE POLICY p2_entry_read ON public.season_entries FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_entry_ins ON public.season_entries FOR INSERT TO authenticated
  WITH CHECK (private.is_member() AND player_id = private.current_player()
              AND paid_at IS NULL AND amount IS NULL AND recorded_by IS NULL);
CREATE POLICY p2_entry_del ON public.season_entries FOR DELETE TO authenticated
  USING (private.is_member() AND player_id = private.current_player() AND paid_at IS NULL);
CREATE POLICY p2_admin ON public.season_entries FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

-- Money trail, like fines and payments: who entered, paid, was un-marked, withdrew.
CREATE FUNCTION private.audit_entries() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit('season_entered', NEW.player_id, jsonb_build_object('season', NEW.season));
    IF NEW.paid_at IS NOT NULL THEN
      PERFORM private.audit('entry_paid', NEW.player_id, jsonb_build_object('season', NEW.season, 'amount', NEW.amount));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.audit('season_withdrawn', OLD.player_id, jsonb_build_object('season', OLD.season));
    RETURN OLD;
  ELSIF OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL THEN
    PERFORM private.audit('entry_paid', NEW.player_id, jsonb_build_object('season', NEW.season, 'amount', NEW.amount));
  ELSIF OLD.paid_at IS NOT NULL AND NEW.paid_at IS NULL THEN
    PERFORM private.audit('entry_unpaid', NEW.player_id, jsonb_build_object('season', NEW.season, 'amount', OLD.amount));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_entries() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_entries AFTER INSERT OR UPDATE OR DELETE ON public.season_entries
  FOR EACH ROW EXECUTE FUNCTION private.audit_entries();

-- ===== CHECKS =====
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_entries';
  INSERT INTO se_report(line) VALUES ('season_entries policies: ' || n);
  IF n <> 5 THEN RAISE EXCEPTION 'Expected 5 policies on season_entries, found %', n; END IF;
  IF NOT has_table_privilege('anon', 'public.season_entries', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.season_entries', 'SELECT') THEN
    RAISE EXCEPTION 'season_entries grants missing';
  END IF;
  INSERT INTO se_report(line) VALUES ('grants: anon + authenticated');
  SELECT count(DISTINCT trigger_name) INTO n FROM information_schema.triggers WHERE event_object_table = 'season_entries';
  IF n <> 1 THEN RAISE EXCEPTION 'Expected 1 trigger on season_entries, found %', n; END IF;
  INSERT INTO se_report(line) VALUES ('audit trigger: 1');
END $$;

NOTIFY pgrst, 'reload schema';
DO $$ BEGIN
  INSERT INTO se_report(line) VALUES ('ALL CHECKS PASSED');
  IF (SELECT rehearsal FROM se_mode) THEN
    RAISE EXCEPTION 'REHEARSAL OK — everything was rolled back. Report:%',
      E'\n' || (SELECT string_agg(line, E'\n' ORDER BY ord) FROM se_report);
  END IF;
END $$;
SELECT line FROM se_report ORDER BY ord;
COMMIT;
