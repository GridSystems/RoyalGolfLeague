-- Royal Golf Club — season-long matchplay league (tournaments.format = 'league').
-- Spec: docs/superpowers/specs/2026-09-25-matchplay-league-design.md
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). REHEARSAL FIRST: with the switch on
-- (true) it runs everything, reports, then rolls back. Set it to false for the real run.
-- Needs phase2a_auth.sql (Phase 2 release A). Undo: matchplay_league_rollback.sql.
-- No version-gate change: the live app reads the new columns only for format = 'league'.
BEGIN;
CREATE TEMP TABLE ml_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH
CREATE TEMP TABLE ml_report (ord serial, line text) ON COMMIT DROP;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'format') THEN
    RAISE EXCEPTION 'The matchplay league is already set up (tournaments.format exists). Nothing was changed.';
  END IF;
  IF to_regprocedure('private.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'phase2a_auth.sql must be applied first. Nothing was changed.';
  END IF;
END $$;

-- ===== Columns (every existing tournament becomes team_day) ==============================
ALTER TABLE public.tournaments
  ADD COLUMN format text NOT NULL DEFAULT 'team_day' CHECK (format IN ('team_day', 'league')),
  ADD COLUMN deadlines jsonb,                  -- {"group_1","group_2","group_3","semi","final"}: play-by dates
  ADD COLUMN buy_in numeric NOT NULL DEFAULT 0 CHECK (buy_in >= 0),
  ADD COLUMN max_players int NOT NULL DEFAULT 16 CHECK (max_players > 0);
ALTER TABLE public.tournament_players
  ADD COLUMN entered_at timestamptz NOT NULL DEFAULT now(),   -- sign-up order: first max_players in, the rest wait
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN amount numeric,
  ADD COLUMN recorded_by bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN seed_pot int CHECK (seed_pot BETWEEN 1 AND 4),
  ADD COLUMN group_num int CHECK (group_num BETWEEN 1 AND 4),
  ADD CONSTRAINT tplayers_paid_amount CHECK ((paid_at IS NULL) = (amount IS NULL)),
  ADD CONSTRAINT tplayers_amount_nonneg CHECK (amount IS NULL OR amount >= 0);
-- round: 1–3 group rounds, 4 semi-finals, 5 finals and 3rd/4th — one per deadline.
ALTER TABLE public.tournament_matches
  ADD COLUMN stage text CHECK (stage IN ('group', 'semi', 'final', 'place')),
  ADD COLUMN bracket int CHECK (bracket BETWEEN 1 AND 4),
  ADD COLUMN start_hole int NOT NULL DEFAULT 1 CHECK (start_hole IN (1, 10)),
  ADD COLUMN extra_holes int NOT NULL DEFAULT 0 CHECK (extra_holes >= 0),
  ADD COLUMN outcome text NOT NULL DEFAULT 'played' CHECK (outcome IN ('played', 'walkover', 'halve_decision', 'double_forfeit')),
  ADD COLUMN decided_by bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN played_on text,                   -- YYYY-MM-DD of the first score: the handicap date
  ADD CONSTRAINT tmatches_bracket_for_playoffs CHECK (stage IS NULL OR (stage = 'group') = (bracket IS NULL)),
  ADD CONSTRAINT tmatches_outcome_league_only CHECK (outcome = 'played' OR stage IS NOT NULL),
  -- Postgres CHECKs pass on NULL, not just TRUE — "OR result = 'half'" would let a NULL result
  -- through, so each of these three wraps the whole OR in "IS TRUE" to force NULL to a failure.
  ADD CONSTRAINT tmatches_halve_group_only CHECK ((outcome <> 'halve_decision' OR (stage = 'group' AND result = 'half')) IS TRUE),
  ADD CONSTRAINT tmatches_walkover_winner CHECK ((outcome <> 'walkover' OR result IN ('a', 'b')) IS TRUE),
  ADD CONSTRAINT tmatches_forfeit_goes_through CHECK ((outcome <> 'double_forfeit'
    OR (stage = 'group' AND result IS NULL) OR (stage <> 'group' AND result IN ('a', 'b'))) IS TRUE);

-- One row per league match slot: all 40 are created at the draw, so a double press can't duplicate.
CREATE UNIQUE INDEX tournament_matches_league_slot ON public.tournament_matches (tournament_id, round, match_num) WHERE stage IS NOT NULL;
-- One entry per player per tournament (team day's assign already guards this in the app).
CREATE UNIQUE INDEX tournament_players_once ON public.tournament_players (tournament_id, player_id);

-- ===== Helpers ==============================================================================
CREATE FUNCTION private.is_league(p_tournament bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT coalesce((SELECT format = 'league' FROM public.tournaments WHERE id = p_tournament), false) $$;
CREATE FUNCTION private.league_open(p_tournament bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament AND format = 'league' AND status = 'entry') $$;
-- Who may write a score row: team day as before (true); a league match's two players (for either of
-- them) until it is finished; an admin in admin mode always — but only for the match's own players.
CREATE FUNCTION private.may_score(p_match bigint, p_player bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(CASE
    WHEN m.id IS NULL OR NOT private.is_league(m.tournament_id) THEN true
    WHEN p_player IS DISTINCT FROM m.team_a_p1_id AND p_player IS DISTINCT FROM m.team_b_p1_id THEN false
    WHEN private.is_admin() THEN true
    ELSE m.status <> 'complete' AND private.current_player() IN (m.team_a_p1_id, m.team_b_p1_id) END, false)
  FROM (SELECT 1) one LEFT JOIN public.tournament_matches m ON m.id = p_match $$;
GRANT EXECUTE ON FUNCTION private.is_league(bigint), private.league_open(bigint), private.may_score(bigint, bigint) TO anon, authenticated;

-- ===== League matches: who may change what ===================================================
-- Requests without a login (the old PIN route) pass unchanged until release B, as everywhere.
CREATE FUNCTION private.protect_league_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE me bigint := private.current_player(); started boolean;
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() OR NOT private.is_league(OLD.tournament_id) THEN RETURN NEW; END IF;
  -- The league's shape and admin decisions: admin mode only.
  IF NEW.tournament_id IS DISTINCT FROM OLD.tournament_id OR NEW.stage IS DISTINCT FROM OLD.stage
     OR NEW.bracket IS DISTINCT FROM OLD.bracket OR NEW.round IS DISTINCT FROM OLD.round
     OR NEW.match_num IS DISTINCT FROM OLD.match_num OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
     OR NEW.team_a_p2_id IS DISTINCT FROM OLD.team_a_p2_id OR NEW.team_b_p2_id IS DISTINCT FROM OLD.team_b_p2_id THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change that.' USING ERRCODE = '42501';
  END IF;
  -- Filling an EMPTY playoff slot as results come in: any member. Never overwriting or emptying one.
  IF NEW.team_a_p1_id IS DISTINCT FROM OLD.team_a_p1_id OR NEW.team_b_p1_id IS DISTINCT FROM OLD.team_b_p1_id THEN
    started := OLD.status <> 'pending' OR EXISTS (SELECT 1 FROM public.tournament_scores WHERE match_id = OLD.id);
    IF OLD.stage = 'group' OR started
       OR (NEW.team_a_p1_id IS DISTINCT FROM OLD.team_a_p1_id AND OLD.team_a_p1_id IS NOT NULL)
       OR (NEW.team_b_p1_id IS DISTINCT FROM OLD.team_b_p1_id AND OLD.team_b_p1_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Only an admin in admin mode can change who plays in a match.' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Playing the match: only its two players, and a finished match only an admin can re-open.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.result IS DISTINCT FROM OLD.result
     OR NEW.extra_holes IS DISTINCT FROM OLD.extra_holes OR NEW.start_hole IS DISTINCT FROM OLD.start_hole
     OR NEW.tee_id IS DISTINCT FROM OLD.tee_id OR NEW.played_on IS DISTINCT FROM OLD.played_on THEN
    IF me IS NULL OR (me IS DISTINCT FROM OLD.team_a_p1_id AND me IS DISTINCT FROM OLD.team_b_p1_id) THEN
      RAISE EXCEPTION 'Only the two players (or an admin) can score this match.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'complete' THEN
      RAISE EXCEPTION 'This match is finished — only an admin can change it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_league_match() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_league_match BEFORE UPDATE ON public.tournament_matches
  FOR EACH ROW EXECUTE FUNCTION private.protect_league_match();

-- A league's own row (deadlines, buy-in, status): admin mode only. Team day: unchanged.
CREATE FUNCTION private.protect_league() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() THEN RETURN NEW; END IF;
  IF (OLD.format = 'league' OR NEW.format = 'league') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change the league.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_league() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_league BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION private.protect_league();

-- ===== Policies ===============================================================================
-- Entries: members enter themselves (unpaid, not placed, signed up now) while entries are open, and
-- withdraw while unpaid and before the draw. Admin mode (existing p2_admin): everything.
CREATE POLICY p2_tplayer_enter ON public.tournament_players FOR INSERT TO authenticated
  WITH CHECK (private.is_member() AND player_id = private.current_player() AND team = 'league'
              AND paid_at IS NULL AND amount IS NULL AND recorded_by IS NULL AND group_num IS NULL AND seed_pot IS NULL
              AND entered_at = now() AND private.league_open(tournament_id));
CREATE POLICY p2_tplayer_withdraw ON public.tournament_players FOR DELETE TO authenticated
  USING (private.is_member() AND player_id = private.current_player() AND paid_at IS NULL AND private.league_open(tournament_id));
-- League scores: restrictive, so they narrow the existing member policies without touching team day.
CREATE POLICY p2_tscore_league_ins ON public.tournament_scores AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (private.may_score(match_id, player_id));
CREATE POLICY p2_tscore_league_upd ON public.tournament_scores AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (private.may_score(match_id, player_id)) WITH CHECK (private.may_score(match_id, player_id));
CREATE POLICY p2_tscore_league_del ON public.tournament_scores AS RESTRICTIVE FOR DELETE TO authenticated
  USING (private.may_score(match_id, player_id));

-- ===== Audit ==================================================================================
CREATE FUNCTION private.audit_league_players() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF private.is_league(OLD.tournament_id) THEN
      PERFORM private.audit('league_withdrawn', OLD.player_id, jsonb_build_object('tournament_id', OLD.tournament_id));
    END IF;
    RETURN OLD;
  END IF;
  IF NOT private.is_league(NEW.tournament_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit('league_entered', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id));
    IF NEW.paid_at IS NOT NULL THEN
      PERFORM private.audit('league_paid', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id, 'amount', NEW.amount));
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL THEN
    PERFORM private.audit('league_paid', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id, 'amount', NEW.amount));
  ELSIF OLD.paid_at IS NOT NULL AND NEW.paid_at IS NULL THEN
    PERFORM private.audit('league_unpaid', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id, 'amount', OLD.amount));
  END IF;
  IF NEW.entered_at IS DISTINCT FROM OLD.entered_at THEN
    PERFORM private.audit('league_entry_moved', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_league_players() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_league_players AFTER INSERT OR UPDATE OR DELETE ON public.tournament_players
  FOR EACH ROW EXECUTE FUNCTION private.audit_league_players();

-- Every admin match decision: an outcome, a finished match re-decided or re-opened, a filled slot changed.
CREATE FUNCTION private.audit_league_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_league(NEW.tournament_id) THEN RETURN NEW; END IF;
  IF NEW.outcome IS DISTINCT FROM OLD.outcome OR (NEW.outcome <> 'played' AND NEW.result IS DISTINCT FROM OLD.result) THEN
    PERFORM private.audit('match_outcome', NEW.team_a_p1_id, jsonb_build_object('tournament_id', NEW.tournament_id,
      'match_id', NEW.id, 'outcome', NEW.outcome, 'result', NEW.result));
  ELSIF OLD.status = 'complete' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.result IS DISTINCT FROM OLD.result) THEN
    PERFORM private.audit('match_edited', NEW.team_a_p1_id, jsonb_build_object('tournament_id', NEW.tournament_id,
      'match_id', NEW.id, 'from', OLD.result, 'to', NEW.result, 'status', NEW.status));
  END IF;
  IF (OLD.team_a_p1_id IS NOT NULL AND NEW.team_a_p1_id IS DISTINCT FROM OLD.team_a_p1_id)
     OR (OLD.team_b_p1_id IS NOT NULL AND NEW.team_b_p1_id IS DISTINCT FROM OLD.team_b_p1_id) THEN
    PERFORM private.audit('match_players_changed', NEW.team_a_p1_id, jsonb_build_object('tournament_id', NEW.tournament_id,
      'match_id', NEW.id, 'from', jsonb_build_array(OLD.team_a_p1_id, OLD.team_b_p1_id), 'to', jsonb_build_array(NEW.team_a_p1_id, NEW.team_b_p1_id)));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_league_match() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_league_match AFTER UPDATE ON public.tournament_matches
  FOR EACH ROW EXECUTE FUNCTION private.audit_league_match();

-- ===== CHECKS =====
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name::text || '.' || column_name::text IN ('tournaments.format', 'tournaments.deadlines', 'tournaments.buy_in',
      'tournaments.max_players', 'tournament_players.entered_at', 'tournament_players.paid_at', 'tournament_players.amount',
      'tournament_players.recorded_by', 'tournament_players.seed_pot', 'tournament_players.group_num', 'tournament_matches.stage',
      'tournament_matches.bracket', 'tournament_matches.start_hole', 'tournament_matches.extra_holes', 'tournament_matches.outcome',
      'tournament_matches.decided_by', 'tournament_matches.played_on');
  IF n <> 17 THEN RAISE EXCEPTION 'Expected 17 new columns, found %', n; END IF;
  INSERT INTO ml_report(line) VALUES ('new columns: 17');
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND policyname IN
    ('p2_tplayer_enter', 'p2_tplayer_withdraw', 'p2_tscore_league_ins', 'p2_tscore_league_upd', 'p2_tscore_league_del');
  IF n <> 5 THEN RAISE EXCEPTION 'Expected 5 new policies, found %', n; END IF;
  INSERT INTO ml_report(line) VALUES ('new policies: 5');
  SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal
    AND tgname IN ('protect_league', 'protect_league_match', 'audit_league_players', 'audit_league_match');
  IF n <> 4 THEN RAISE EXCEPTION 'Expected 4 new triggers, found %', n; END IF;
  INSERT INTO ml_report(line) VALUES ('new triggers: 4');
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE format <> 'team_day') THEN
    RAISE EXCEPTION 'Existing tournaments must all be team_day';
  END IF;
  INSERT INTO ml_report(line) VALUES ('existing tournaments: ' || (SELECT count(*) FROM public.tournaments) || ', all team_day');
  IF NOT has_table_privilege('authenticated', 'public.tournament_players', 'INSERT')
     OR NOT has_table_privilege('anon', 'public.tournament_matches', 'UPDATE')
     OR NOT has_function_privilege('authenticated', 'private.may_score(bigint,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants missing';
  END IF;
  INSERT INTO ml_report(line) VALUES ('grants: tables + helper functions');
END $$;

NOTIFY pgrst, 'reload schema';
DO $$ BEGIN
  INSERT INTO ml_report(line) VALUES ('ALL CHECKS PASSED');
  IF (SELECT rehearsal FROM ml_mode) THEN
    RAISE EXCEPTION 'REHEARSAL OK — everything was rolled back. Report:%',
      E'\n' || (SELECT string_agg(line, E'\n' ORDER BY ord) FROM ml_report);
  END IF;
END $$;
SELECT line FROM ml_report ORDER BY ord;
COMMIT;
