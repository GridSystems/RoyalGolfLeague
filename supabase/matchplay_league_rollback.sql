-- Royal Golf Club — undo matchplay_league.sql. League tournaments (their entries, matches and scores)
-- are deleted; team-day tournaments are untouched; the audit log keeps its league rows.
-- Redeploy the previous app straight after. Safe to re-run.
-- If both this and phase2a_rollback.sql are ever run, run THIS ONE FIRST — its functions and
-- triggers reference private.is_admin() etc. from phase2a_auth.sql.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'format') THEN
    EXECUTE 'DELETE FROM public.tournaments WHERE format = ''league''';   -- cascades to players, matches, scores
  END IF;
END $$;
DROP TRIGGER IF EXISTS protect_league ON public.tournaments;
DROP TRIGGER IF EXISTS protect_league_match ON public.tournament_matches;
DROP TRIGGER IF EXISTS audit_league_match ON public.tournament_matches;
DROP TRIGGER IF EXISTS audit_league_players ON public.tournament_players;
DROP POLICY IF EXISTS p2_tplayer_enter ON public.tournament_players;
DROP POLICY IF EXISTS p2_tplayer_withdraw ON public.tournament_players;
DROP POLICY IF EXISTS p2_tscore_league_ins ON public.tournament_scores;
DROP POLICY IF EXISTS p2_tscore_league_upd ON public.tournament_scores;
DROP POLICY IF EXISTS p2_tscore_league_del ON public.tournament_scores;
DROP FUNCTION IF EXISTS private.protect_league();
DROP FUNCTION IF EXISTS private.protect_league_match();
DROP FUNCTION IF EXISTS private.audit_league_players();
DROP FUNCTION IF EXISTS private.audit_league_match();
DROP FUNCTION IF EXISTS private.may_score(bigint, bigint);
DROP FUNCTION IF EXISTS private.league_open(bigint);
DROP FUNCTION IF EXISTS private.is_league(bigint);
DROP INDEX IF EXISTS public.tournament_matches_league_slot;
DROP INDEX IF EXISTS public.tournament_players_once;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS format, DROP COLUMN IF EXISTS deadlines,
  DROP COLUMN IF EXISTS buy_in, DROP COLUMN IF EXISTS max_players;
ALTER TABLE public.tournament_players DROP COLUMN IF EXISTS entered_at, DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS amount, DROP COLUMN IF EXISTS recorded_by, DROP COLUMN IF EXISTS seed_pot, DROP COLUMN IF EXISTS group_num;
ALTER TABLE public.tournament_matches DROP COLUMN IF EXISTS stage, DROP COLUMN IF EXISTS bracket,
  DROP COLUMN IF EXISTS start_hole, DROP COLUMN IF EXISTS extra_holes, DROP COLUMN IF EXISTS outcome,
  DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS played_on;
NOTIFY pgrst, 'reload schema';
COMMIT;
