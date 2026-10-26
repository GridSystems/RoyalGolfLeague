-- Royal Golf Club — who may write a round, and an audit trail of changes (2026-10-26).
-- Security review SEC-05: p2_rounds_upd let any member change any round, and nothing recorded it.
--   Today's rounds (Copenhagen day): any member — one phone scores the whole group.
--   An earlier day: a player's own round only, up to 7 days back — "forgot to log last Saturday".
--   Anything else, and moving a round to another player or date: an admin in admin mode.
--   A round with no scores may still be deleted by any member (no-show; noshow_round_delete.sql).
-- rounds.date may be text or date (production has date): everything here compares it as YYYY-MM-DD text.
-- Rules live here, not in the app: a request sent from curl or devtools meets the same ones.
-- Audit (a trigger, so it catches every write whoever sends it):
--   round_edited    a change to a round dated before today, or moving any round to another player
--                   or date. Details name the holes whose score changed (old→new).
--   round_backdated a round inserted with a date before today (incl. admin bulk entry).
--   round_deleted   a round with any score deleted.
-- Live scoring of today's rounds is not logged: a PATCH per hole per player would flood the log.
-- Run in the Supabase SQL Editor. Needs phase2a_auth.sql. Safe to re-run. Undo: bottom of file.
BEGIN;

-- The club's calendar day, n days from today, as rounds.date stores it (YYYY-MM-DD).
CREATE OR REPLACE FUNCTION private.club_day(n int DEFAULT 0) RETURNS text LANGUAGE sql STABLE SET search_path = '' AS
  $$ SELECT to_char((now() AT TIME ZONE 'Europe/Copenhagen')::date + n, 'YYYY-MM-DD') $$;
CREATE OR REPLACE FUNCTION private.round_writable(p_player bigint, p_date text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_admin()
      OR (private.is_member() AND p_date = private.club_day())
      OR (p_player = private.current_player() AND p_date BETWEEN private.club_day(-7) AND private.club_day())
$$;
REVOKE ALL ON FUNCTION private.club_day(int), private.round_writable(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.club_day(int), private.round_writable(bigint, text) TO authenticated;

DROP POLICY IF EXISTS p2_rounds_write ON public.rounds;
DROP POLICY IF EXISTS p2_rounds_upd ON public.rounds;
DROP POLICY IF EXISTS p2_rounds_del ON public.rounds;
CREATE POLICY p2_rounds_write ON public.rounds FOR INSERT TO authenticated WITH CHECK (private.round_writable(player_id, date::text));
CREATE POLICY p2_rounds_upd ON public.rounds FOR UPDATE TO authenticated
  USING (private.round_writable(player_id, date::text)) WITH CHECK (private.round_writable(player_id, date::text));
CREATE POLICY p2_rounds_del ON public.rounds FOR DELETE TO authenticated USING (private.is_admin()
  OR (player_id = private.current_player() AND private.round_writable(player_id, date::text))
  OR (private.is_member() AND NOT jsonb_path_exists(holes, '$[*] ? (@.score != null)')));

-- Whose round and which day it was: admin mode only, today included (the policies alone would let a
-- member hand today's round to someone else, since both sides of that move are "today").
CREATE OR REPLACE FUNCTION private.protect_round_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() THEN RETURN NEW; END IF;
  IF NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.date IS DISTINCT FROM OLD.date THEN
    RAISE EXCEPTION 'Only an admin in admin mode can move a round to another player or date.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_round_fields() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_round_fields ON public.rounds;
CREATE TRIGGER protect_round_fields BEFORE UPDATE ON public.rounds FOR EACH ROW EXECUTE FUNCTION private.protect_round_fields();

-- Holes whose score differs, as '4: 5→4, 7: –→6' ('–' = no score); null when none differ.
CREATE OR REPLACE FUNCTION private.round_diff(o jsonb, n jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT string_agg(format('%s: %s→%s', i + 1, coalesce(o -> i ->> 'score', '–'), coalesce(n -> i ->> 'score', '–')), ', ' ORDER BY i)
    FROM generate_series(0, greatest(CASE WHEN jsonb_typeof(o) = 'array' THEN jsonb_array_length(o) ELSE 0 END,
                                     CASE WHEN jsonb_typeof(n) = 'array' THEN jsonb_array_length(n) ELSE 0 END) - 1) i
   WHERE (o -> i ->> 'score') IS DISTINCT FROM (n -> i ->> 'score')
$$;
REVOKE ALL ON FUNCTION private.round_diff(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.audit_rounds() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE today text := private.club_day(); other text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.date::text < today THEN
      PERFORM private.audit('round_backdated', NEW.player_id, jsonb_build_object('round', NEW.id, 'date', NEW.date));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF jsonb_path_exists(coalesce(OLD.holes, '[]'), '$[*] ? (@.score != null)') THEN
      PERFORM private.audit('round_deleted', OLD.player_id, jsonb_build_object('round', OLD.id, 'date', OLD.date));
    END IF;
    RETURN OLD;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF OLD.date::text < today OR NEW.date IS DISTINCT FROM OLD.date OR NEW.player_id IS DISTINCT FROM OLD.player_id THEN
    SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO other FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key AND n.key NOT IN ('holes', 'marker_holes', 'player_id', 'date');
    PERFORM private.audit('round_edited', NEW.player_id, jsonb_strip_nulls(jsonb_build_object('round', NEW.id, 'date', OLD.date,
      'holes', private.round_diff(OLD.holes, NEW.holes), 'marker_holes', private.round_diff(OLD.marker_holes, NEW.marker_holes),
      'player', CASE WHEN NEW.player_id IS DISTINCT FROM OLD.player_id THEN OLD.player_id || '→' || NEW.player_id END,
      'new_date', CASE WHEN NEW.date IS DISTINCT FROM OLD.date THEN NEW.date END, 'fields', other)));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_rounds() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_rounds ON public.rounds;
CREATE TRIGGER audit_rounds AFTER INSERT OR UPDATE OR DELETE ON public.rounds FOR EACH ROW EXECUTE FUNCTION private.audit_rounds();

-- ===== CHECK: permissive policies OR together, so any other write policy on rounds would undo this.
DO $$ DECLARE bad text; BEGIN
  SELECT string_agg(policyname || ' (' || cmd || ')', ', ') INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'rounds' AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT'
     AND policyname NOT IN ('p2_rounds_write', 'p2_rounds_upd', 'p2_rounds_del');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Other write policies on rounds would override these rules: %. Nothing was changed.', bad; END IF;
END $$;
COMMIT;

-- Undo (back to phase2a_auth.sql + noshow_round_delete.sql; the audit rows stay):
-- BEGIN;
-- DROP TRIGGER IF EXISTS audit_rounds ON public.rounds;
-- DROP TRIGGER IF EXISTS protect_round_fields ON public.rounds;
-- DROP POLICY p2_rounds_write ON public.rounds; DROP POLICY p2_rounds_upd ON public.rounds; DROP POLICY p2_rounds_del ON public.rounds;
-- CREATE POLICY p2_rounds_write ON public.rounds FOR INSERT TO authenticated WITH CHECK (private.is_member() OR player_id = private.current_player());
-- CREATE POLICY p2_rounds_upd ON public.rounds FOR UPDATE TO authenticated USING (private.is_member() OR player_id = private.current_player()) WITH CHECK (private.is_member() OR player_id = private.current_player());
-- CREATE POLICY p2_rounds_del ON public.rounds FOR DELETE TO authenticated USING (player_id = private.current_player() OR private.is_admin()
--   OR (private.is_member() AND NOT jsonb_path_exists(holes, '$[*] ? (@.score != null)')));
-- DROP FUNCTION IF EXISTS private.audit_rounds(), private.round_diff(jsonb, jsonb), private.protect_round_fields(),
--   private.round_writable(bigint, text), private.club_day(int);
-- COMMIT;
