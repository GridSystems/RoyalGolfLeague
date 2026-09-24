-- Royal Golf Club — Phase 1: clean IDs and foreign keys
-- Spec: docs/superpowers/specs/2026-09-24-phase1-ids-design.md
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai).
--
-- REHEARSAL FIRST. With the switch below on `true` the script does everything, then
-- fails on purpose with the check report as its error message — which undoes it all.
-- Real run: change `true` to `false`; it commits and the report is the result.
-- Real run only on a weekday evening with nobody scoring, then push the app at once:
-- the new app sends no ids, and from here the database refuses the old app's ids.

BEGIN;

CREATE TEMP TABLE p1_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH

-- 0. Guards ----------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='players' AND column_name='legacy_id') THEN
    RAISE EXCEPTION 'Phase 1 has already been applied (players.legacy_id exists). Nothing was changed.';
  END IF;
  -- A phone still running the old app would silently lose scores for a round whose id changed.
  IF EXISTS (SELECT 1 FROM public.rounds r
             WHERE r.date::text = to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD')
               AND r.created_at > now() - interval '6 hours'
               AND (SELECT count(*) FROM jsonb_array_elements(coalesce(r.holes, '[]'::jsonb)) h
                    WHERE h->>'score' IS NOT NULL OR h->>'pickup' = 'true') < 18) THEN
    RAISE EXCEPTION 'A round started today is being scored. Run the migration once it is finished.';
  END IF;
END $$;

-- 1. The numbers the checks compare against ---------------------------------------------
CREATE TEMP TABLE p1_before (k text PRIMARY KEY, v numeric) ON COMMIT DROP;
CREATE TEMP TABLE p1_orphans (k text PRIMARY KEY, n bigint) ON COMMIT DROP;
CREATE TEMP TABLE p1_report (ord serial, line text) ON COMMIT DROP;
DO $$ DECLARE t text; n bigint; BEGIN
  FOREACH t IN ARRAY ARRAY['players','rounds','fine_types','fines','fine_payments','saturday_events',
    'saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    INSERT INTO p1_before VALUES ('rows:' || t, n);
  END LOOP;
  INSERT INTO p1_before SELECT 'fines_dkk', coalesce(sum(amount), 0) FROM public.fines;
  INSERT INTO p1_before SELECT 'payments_dkk', coalesce(sum(amount), 0) FROM public.fine_payments;
END $$;
CREATE TEMP TABLE p1_rounds_before ON COMMIT DROP AS
  SELECT player_id, count(*) AS n FROM public.rounds GROUP BY player_id;

-- 1b. Behaviour the API can't show us. Renumbering updates every row, so an UPDATE trigger
-- or a Supabase database webhook (also a trigger) would fire once per row. List them all in
-- the report; the rehearsal shows them before anything is committed.
DO $$ DECLARE r record; nt int := 0; nv int := 0; BEGIN
  FOR r IN SELECT event_object_table AS t, trigger_name AS name,
                  string_agg(DISTINCT action_timing || ' ' || event_manipulation, ', ') AS what
             FROM information_schema.triggers
            WHERE event_object_schema = 'public'
              AND event_object_table IN ('players','rounds','fine_types','fines','fine_payments','saturday_events',
                    'saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores')
            GROUP BY 1, 2 LOOP
    nt := nt + 1; INSERT INTO p1_report(line) VALUES (format('TRIGGER on %s: %s (%s)', r.t, r.name, r.what));
  END LOOP;
  FOR r IN SELECT DISTINCT view_schema || '.' || view_name AS v, table_name AS t
             FROM information_schema.view_table_usage
            WHERE table_schema = 'public'
              AND table_name IN ('players','rounds','fine_types','fines','fine_payments','saturday_events',
                    'saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores') LOOP
    nv := nv + 1; INSERT INTO p1_report(line) VALUES (format('VIEW %s reads %s', r.v, r.t));
  END LOOP;
  INSERT INTO p1_report(line) VALUES (format('triggers: %s, views: %s', nt, nv));
END $$;

-- 2. Backup (not reachable through the API) ----------------------------------------------
CREATE SCHEMA IF NOT EXISTS phase1_backup;
REVOKE ALL ON SCHEMA phase1_backup FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['players','rounds','fine_types','fines','fine_payments','saturday_events',
    'saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores'] LOOP
    EXECUTE format('DROP TABLE IF EXISTS phase1_backup.%I', t);
    EXECUTE format('CREATE TABLE phase1_backup.%I AS TABLE public.%I', t, t);
  END LOOP;
END $$;

-- 3. New player columns ------------------------------------------------------------------
ALTER TABLE public.players ADD COLUMN archived_at timestamptz, ADD COLUMN legacy_id bigint;
UPDATE public.players SET legacy_id = id;

-- 4. Orphans -----------------------------------------------------------------------------
DO $$ DECLARE n bigint; BEGIN
  -- Fines pointing at a deleted round: re-link to the player's only round that day ...
  UPDATE public.fines f SET round_id = r.id
    FROM public.rounds r
   WHERE f.round_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rounds x WHERE x.id = f.round_id)
     AND r.player_id = f.player_id AND r.date::text = f.date::text
     AND (SELECT count(*) FROM public.rounds y WHERE y.player_id = f.player_id AND y.date::text = f.date::text) = 1;
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO p1_orphans VALUES ('fines re-linked to a round', n);
  -- ... otherwise keep the fine and clear the link.
  UPDATE public.fines f SET round_id = NULL
   WHERE f.round_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rounds x WHERE x.id = f.round_id);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO p1_orphans VALUES ('fines with round link cleared', n);

  -- Fines of deleted players move to one archived placeholder, so the fine pot keeps them.
  IF EXISTS (SELECT 1 FROM public.fines f WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = f.player_id)) THEN
    INSERT INTO public.players (id, name, color, hcp_history, approved, is_social, is_admin, created_at, archived_at)
    VALUES (-1, 'Former member', 0, '[]'::jsonb, true, true, false, now(), now());
    UPDATE public.fines f SET player_id = -1
     WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = f.player_id);
    GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO p1_orphans VALUES ('fines moved to Former member', n);
  END IF;

  DELETE FROM public.saturday_signups s WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = s.player_id);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO p1_orphans VALUES ('sign-ups deleted', n);
  DELETE FROM public.tournament_players tp WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = tp.player_id);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO p1_orphans VALUES ('tournament entries deleted', n);

  -- Anything else orphaned was not in the plan: stop rather than guess.
  IF EXISTS (SELECT 1 FROM public.rounds x WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = x.player_id))
  OR EXISTS (SELECT 1 FROM public.fine_payments x WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = x.player_id))
  OR EXISTS (SELECT 1 FROM public.gps_shots x WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = x.player_id))
  OR EXISTS (SELECT 1 FROM public.tournament_scores x WHERE NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = x.player_id))
  OR EXISTS (SELECT 1 FROM public.fines x WHERE x.fine_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fine_types t WHERE t.id = x.fine_type_id))
  OR EXISTS (SELECT 1 FROM public.tournament_players x WHERE NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = x.tournament_id))
  OR EXISTS (SELECT 1 FROM public.tournament_matches x WHERE NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = x.tournament_id))
  OR EXISTS (SELECT 1 FROM public.tournament_scores x WHERE NOT EXISTS (SELECT 1 FROM public.tournament_matches m WHERE m.id = x.match_id)) THEN
    RAISE EXCEPTION 'Unplanned orphaned rows found (rounds, payments, GPS shots, fine types or tournaments). Nothing was changed.';
  END IF;
END $$;

-- 5. Columns that only mention a player become optional; clear any that point at nobody --
ALTER TABLE public.rounds        ALTER COLUMN marker_id   DROP NOT NULL;
ALTER TABLE public.fines         ALTER COLUMN issued_by   DROP NOT NULL;
ALTER TABLE public.fine_payments ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE public.tournaments   ALTER COLUMN team_a_captain_id DROP NOT NULL, ALTER COLUMN team_b_captain_id DROP NOT NULL;
ALTER TABLE public.tournament_matches ALTER COLUMN team_a_p1_id DROP NOT NULL, ALTER COLUMN team_a_p2_id DROP NOT NULL,
                                      ALTER COLUMN team_b_p1_id DROP NOT NULL, ALTER COLUMN team_b_p2_id DROP NOT NULL;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT * FROM (VALUES ('rounds','marker_id'), ('fines','issued_by'), ('fine_payments','recorded_by'),
      ('tournaments','team_a_captain_id'), ('tournaments','team_b_captain_id'),
      ('tournament_matches','team_a_p1_id'), ('tournament_matches','team_a_p2_id'),
      ('tournament_matches','team_b_p1_id'), ('tournament_matches','team_b_p2_id')) v(t, col) LOOP
    EXECUTE format('UPDATE public.%I x SET %I = NULL WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = x.%I)',
                   c.t, c.col, c.col, c.col);
  END LOOP;
END $$;

-- 6. Keys: record and drop any existing foreign keys, make sure every id is a primary key --
CREATE TABLE phase1_backup.dropped_fks (tbl text, conname text, def text);
DO $$ DECLARE c record; t text; BEGIN
  FOR c IN SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
             FROM pg_constraint
            WHERE contype = 'f'
              AND (conrelid::regclass::text IN ('players','rounds','fine_types','fines','fine_payments','saturday_events','saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores')
                OR confrelid::regclass::text IN ('players','rounds','fine_types','fines','fine_payments','saturday_events','saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores')) LOOP
    INSERT INTO phase1_backup.dropped_fks VALUES (c.tbl, c.conname, c.def);
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['players','rounds','fine_types','fines','fine_payments','saturday_events',
    'saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'p' AND conrelid = format('public.%I', t)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (id)', t);
    END IF;
  END LOOP;
END $$;

-- Rows that belong to a player cannot outlive them (RESTRICT); mentions are cleared (SET NULL).
-- ON UPDATE CASCADE is what lets step 7 renumber with one UPDATE per table.
ALTER TABLE public.rounds             ADD CONSTRAINT fk_rounds_player          FOREIGN KEY (player_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.fines              ADD CONSTRAINT fk_fines_player           FOREIGN KEY (player_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.fine_payments      ADD CONSTRAINT fk_payments_player        FOREIGN KEY (player_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.saturday_signups   ADD CONSTRAINT fk_signups_player         FOREIGN KEY (player_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.gps_shots          ADD CONSTRAINT fk_gps_player             FOREIGN KEY (player_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.tournament_players ADD CONSTRAINT fk_tplayers_player        FOREIGN KEY (player_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.tournament_scores  ADD CONSTRAINT fk_tscores_player         FOREIGN KEY (player_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.rounds             ADD CONSTRAINT fk_rounds_marker          FOREIGN KEY (marker_id)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.fines              ADD CONSTRAINT fk_fines_issued_by        FOREIGN KEY (issued_by)        REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.fine_payments      ADD CONSTRAINT fk_payments_recorded_by   FOREIGN KEY (recorded_by)      REFERENCES public.players(id)            ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.tournaments        ADD CONSTRAINT fk_tournaments_captain_a  FOREIGN KEY (team_a_captain_id) REFERENCES public.players(id)           ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.tournaments        ADD CONSTRAINT fk_tournaments_captain_b  FOREIGN KEY (team_b_captain_id) REFERENCES public.players(id)           ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.fines              ADD CONSTRAINT fk_fines_round            FOREIGN KEY (round_id)         REFERENCES public.rounds(id)             ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.fines              ADD CONSTRAINT fk_fines_type             FOREIGN KEY (fine_type_id)     REFERENCES public.fine_types(id)         ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.tournament_players ADD CONSTRAINT fk_tplayers_tournament    FOREIGN KEY (tournament_id)    REFERENCES public.tournaments(id)        ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.tournament_matches ADD CONSTRAINT fk_tmatches_tournament    FOREIGN KEY (tournament_id)    REFERENCES public.tournaments(id)        ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.tournament_scores  ADD CONSTRAINT fk_tscores_match          FOREIGN KEY (match_id)         REFERENCES public.tournament_matches(id) ON UPDATE CASCADE ON DELETE CASCADE;
-- The four match slots are mentions: SET NULL. (The spec lists them as one row; they are four constraints, 21 in total.)
ALTER TABLE public.tournament_matches ADD CONSTRAINT fk_tmatches_a1 FOREIGN KEY (team_a_p1_id) REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
                                      ADD CONSTRAINT fk_tmatches_a2 FOREIGN KEY (team_a_p2_id) REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
                                      ADD CONSTRAINT fk_tmatches_b1 FOREIGN KEY (team_b_p1_id) REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
                                      ADD CONSTRAINT fk_tmatches_b2 FOREIGN KEY (team_b_p2_id) REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 7. Renumber 1..N in creation order; ON UPDATE CASCADE carries every reference along -----
-- New ids are small and old ids are 13 digits (or -1), so no id collides mid-update.
DO $$ DECLARE t text; ord text; BEGIN
  FOREACH t IN ARRAY ARRAY['players','rounds','fine_types','fines','fine_payments','saturday_events',
    'saturday_signups','tournaments','tournament_players','tournament_matches','tournament_scores'] LOOP
    ord := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at')
                THEN 'created_at, id' ELSE 'id' END;
    EXECUTE format('UPDATE public.%1$I x SET id = m.n FROM (SELECT id, row_number() OVER (ORDER BY %2$s) AS n FROM public.%1$I) m
                    WHERE x.id = m.id AND x.id <> m.n', t, ord);
  END LOOP;
END $$;

-- 8. Only the database assigns ids from now on ------------------------------------------
DO $$ DECLARE t text; ident "char"; mx bigint; BEGIN
  FOREACH t IN ARRAY ARRAY['players','rounds','fine_types','fines','fine_payments','saturday_events',
    'saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores'] LOOP
    SELECT attidentity INTO ident FROM pg_attribute WHERE attrelid = format('public.%I', t)::regclass AND attname = 'id';
    EXECUTE format('SELECT coalesce(max(id), 0) FROM public.%I', t) INTO mx;
    IF ident = 'a' THEN
      NULL;
    ELSIF ident = 'd' THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET GENERATED ALWAYS', t);
    ELSE
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP DEFAULT', t);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY', t);
    END IF;
    PERFORM setval(pg_get_serial_sequence(format('public.%I', t), 'id'), greatest(mx, 1), mx > 0);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- 9. Grants for the new player columns (Phase 0: players grants are column-level) -------
GRANT SELECT (archived_at, legacy_id) ON public.players TO anon, authenticated;
GRANT UPDATE (archived_at) ON public.players TO anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_user') THEN
    GRANT SELECT (archived_at, legacy_id) ON public.players TO readonly_user;
  END IF;
END $$;

-- 10. Archived players cannot log in (Phase 0's login, plus one condition) ---------------
CREATE OR REPLACE FUNCTION public.login(p_email text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE pl public.players%ROWTYPE; res text;
BEGIN
  SELECT * INTO pl FROM public.players
   WHERE lower(email) = lower(trim(p_email)) AND archived_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  res := public._check_pin(pl.id, p_pin);
  IF res = 'unset' THEN RETURN jsonb_build_object('ok', true, 'id', pl.id, 'name', pl.name, 'needs_pin', true); END IF;
  IF res = 'ok'    THEN RETURN jsonb_build_object('ok', true, 'id', pl.id, 'name', pl.name); END IF;
  RETURN jsonb_build_object('ok', false, 'locked', res = 'locked');
END $fn$;

-- 10b. Version gate: PostgREST runs this before every API request. The old app sends no
-- x-app-version, so it is refused (HTTP 426) on its first request instead of silently
-- saving edits against ids that no longer exist. The new app reloads itself on a 426.
-- Bump the minimum together with APP_VERSION in index.html and course-mapper.html.
CREATE OR REPLACE FUNCTION public.require_current_app() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text := current_setting('request.headers', true)::json ->> 'x-app-version';
BEGIN
  IF current_user = 'service_role' THEN RETURN; END IF;
  IF coalesce(v, '') !~ '^\d+$' OR v::int < 2 THEN
    RAISE SQLSTATE 'PT426' USING MESSAGE = 'This version of the app is out of date. Please reload the page.';
  END IF;
END $fn$;
GRANT EXECUTE ON FUNCTION public.require_current_app() TO anon, authenticated;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.require_current_app';
INSERT INTO p1_report(line) VALUES ('version gate: requests need x-app-version >= 2');

-- 11. Checks — any failure raises and undoes everything ------------------------------------
DO $$ DECLARE t text; n bigint; mn bigint; mx bigint; b numeric; want bigint; bad text := ''; o record; BEGIN
  FOREACH t IN ARRAY ARRAY['players','rounds','fine_types','fines','fine_payments','saturday_events',
    'saturday_signups','gps_shots','tournaments','tournament_players','tournament_matches','tournament_scores'] LOOP
    EXECUTE format('SELECT count(*), coalesce(min(id), 0), coalesce(max(id), 0) FROM public.%I', t) INTO n, mn, mx;
    SELECT v INTO b FROM p1_before WHERE k = 'rows:' || t;
    want := b
      - CASE t WHEN 'saturday_signups'   THEN coalesce((SELECT p.n FROM p1_orphans p WHERE p.k = 'sign-ups deleted'), 0)
               WHEN 'tournament_players' THEN coalesce((SELECT p.n FROM p1_orphans p WHERE p.k = 'tournament entries deleted'), 0)
               ELSE 0 END
      + CASE WHEN t = 'players' AND EXISTS (SELECT 1 FROM public.players WHERE legacy_id IS NULL) THEN 1 ELSE 0 END;
    IF n <> want THEN bad := bad || format('%s has %s rows, expected %s. ', t, n, want); END IF;
    IF t <> 'gps_shots' AND n > 0 AND (mn <> 1 OR mx <> n) THEN bad := bad || format('%s ids run %s-%s for %s rows. ', t, mn, mx, n); END IF;
    INSERT INTO p1_report(line) VALUES (format('%s: %s rows (was %s), ids %s-%s', t, n, b, mn, mx));
  END LOOP;
  IF (SELECT coalesce(sum(amount), 0) FROM public.fines) <> (SELECT v FROM p1_before WHERE k = 'fines_dkk') THEN bad := bad || 'Fines total changed. '; END IF;
  IF (SELECT coalesce(sum(amount), 0) FROM public.fine_payments) <> (SELECT v FROM p1_before WHERE k = 'payments_dkk') THEN bad := bad || 'Payments total changed. '; END IF;
  INSERT INTO p1_report(line) SELECT format('fines DKK %s, payments DKK %s (unchanged)', (SELECT v FROM p1_before WHERE k = 'fines_dkk'), (SELECT v FROM p1_before WHERE k = 'payments_dkk'));
  IF EXISTS (SELECT 1 FROM p1_rounds_before rb
             FULL JOIN (SELECT p.legacy_id, count(*) AS n FROM public.rounds r JOIN public.players p ON p.id = r.player_id GROUP BY p.legacy_id) ra
               ON ra.legacy_id = rb.player_id
             WHERE rb.n IS DISTINCT FROM ra.n) THEN bad := bad || 'Rounds per player changed. '; END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE contype = 'f' AND conname LIKE 'fk\_%';
  IF n <> 21 THEN bad := bad || format('%s foreign keys, expected 21. ', n); END IF;
  FOR o IN SELECT * FROM p1_orphans ORDER BY k LOOP INSERT INTO p1_report(line) VALUES (format('%s: %s', o.k, o.n)); END LOOP;
  INSERT INTO p1_report(line) VALUES (format('%s foreign keys', n));
  IF bad <> '' THEN RAISE EXCEPTION 'CHECKS FAILED — nothing was changed: %', bad; END IF;
  INSERT INTO p1_report(line) VALUES ('ALL CHECKS PASSED');
END $$;

-- 12. Rehearsal stops here: the error message is the report, and everything is undone ----
DO $$ BEGIN
  IF (SELECT rehearsal FROM p1_mode) THEN
    RAISE EXCEPTION E'REHEARSAL OK — everything was rolled back. Report:\n%',
      (SELECT string_agg(line, E'\n' ORDER BY ord) FROM p1_report);
  END IF;
END $$;

CREATE TABLE phase1_backup.report AS SELECT ord, line FROM p1_report;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
COMMIT;
SELECT line FROM phase1_backup.report ORDER BY ord;
