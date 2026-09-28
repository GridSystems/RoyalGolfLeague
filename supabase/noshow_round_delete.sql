-- Royal Golf Club — let a member delete a round that has no scores (2026-09-28).
-- A no-show put in a group gets a round at the start of scoring; picking up every hole leaves
-- it with no scores, which Save refuses. Log Round's "Didn't turn up?" deletes that round, but
-- a member could only delete their own. A round with any score still needs its owner or an
-- admin in admin mode. Pickups are stored as score:null, so they don't count as scores.
-- Run in the Supabase SQL Editor. Needs phase2a_auth.sql, which carries the same policy.
-- Undo: run the two statements at the bottom instead.
BEGIN;
DROP POLICY p2_rounds_del ON public.rounds;
CREATE POLICY p2_rounds_del ON public.rounds FOR DELETE TO authenticated USING (player_id = private.current_player() OR private.is_admin()
  OR (private.is_member() AND NOT jsonb_path_exists(holes, '$[*] ? (@.score != null)')));
COMMIT;

-- Undo:
-- DROP POLICY p2_rounds_del ON public.rounds;
-- CREATE POLICY p2_rounds_del ON public.rounds FOR DELETE TO authenticated USING (player_id = private.current_player() OR private.is_admin());
