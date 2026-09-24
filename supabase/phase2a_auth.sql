-- Royal Golf Club — Phase 2 release A: real login, permissions for logged-in users, audit log
-- Spec: docs/superpowers/specs/2026-09-24-phase2-auth-design.md
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). REHEARSAL FIRST: with the switch on
-- `true` the script does everything, then fails on purpose with the report — which undoes it all.
-- Real run: `false`, then push the app at once (the gate refuses version 2 from here).
-- The old PIN route (public key) keeps working until release B.

BEGIN;
CREATE TEMP TABLE p2_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH
CREATE TEMP TABLE p2_report (ord serial, line text) ON COMMIT DROP;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name='user_id') THEN
    RAISE EXCEPTION 'Phase 2 release A has already been applied (players.user_id exists). Nothing was changed.';
  END IF;
END $$;

-- ===== SECTION 1: identity ================================================================
ALTER TABLE public.players ADD COLUMN user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
GRANT SELECT (user_id) ON public.players TO anon, authenticated;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

-- The signed-in player (active only), and the same including archived (for audit attribution).
CREATE FUNCTION private.current_player() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT id FROM public.players WHERE user_id = auth.uid() AND archived_at IS NULL $$;
CREATE FUNCTION private.acting_player() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT id FROM public.players WHERE user_id = auth.uid() $$;
CREATE FUNCTION private.is_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid() AND approved IS NOT FALSE AND archived_at IS NULL) $$;
-- Admin mode: an admin who has entered their authenticator code in the last 12 hours.
CREATE FUNCTION private.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid() AND is_admin AND approved IS NOT FALSE AND archived_at IS NULL)
     AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
                 WHERE e ->> 'method' = 'totp' AND (e ->> 'timestamp')::numeric >= extract(epoch FROM now()) - 43200) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO anon, authenticated;

-- ===== SECTION 2: audit log ================================================================
CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_player_id bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  action text NOT NULL,
  target_player_id bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  details jsonb);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

-- The only writer. Also trims entries older than 12 months (no scheduler to fail quietly).
-- Never raises: a failure to log must not break what is being logged.
CREATE FUNCTION private.audit(p_action text, p_target bigint, p_details jsonb, p_actor bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.audit_log (actor_player_id, action, target_player_id, details)
  VALUES (coalesce(p_actor, private.acting_player()), p_action, p_target, p_details);
  DELETE FROM public.audit_log WHERE at < now() - interval '12 months';
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'audit(%): %', p_action, SQLERRM;
END $$;
-- Postgres grants EXECUTE to PUBLIC on creation, and schema private has USAGE for
-- anon/authenticated — without this, any logged-in member (or anon) could forge audit rows by
-- calling private.audit() directly. Only ever called via PERFORM from SECURITY DEFINER functions,
-- which run as the owner regardless of this revoke.
REVOKE ALL ON FUNCTION private.audit(text, bigint, jsonb, bigint) FROM PUBLIC, anon, authenticated;

-- Members change only their own profile fields; status fields need admin mode. Requests without a
-- login token (the old PIN route) pass unchanged until release B.
CREATE FUNCTION private.protect_player_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() THEN RETURN NEW; END IF;
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.is_social IS DISTINCT FROM OLD.is_social OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.legacy_id IS DISTINCT FROM OLD.legacy_id THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change that.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_player_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_player_fields BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION private.protect_player_fields();

CREATE FUNCTION private.audit_players() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    PERFORM private.audit(CASE WHEN NEW.is_admin THEN 'admin_granted' ELSE 'admin_removed' END, NEW.id, NULL); END IF;
  IF NEW.approved IS TRUE AND OLD.approved IS FALSE THEN PERFORM private.audit('approved', NEW.id, NULL); END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM private.audit(CASE WHEN NEW.archived_at IS NULL THEN 'restored' ELSE 'archived' END, NEW.id, NULL); END IF;
  IF NEW.is_social IS DISTINCT FROM OLD.is_social THEN
    PERFORM private.audit('social_changed', NEW.id, jsonb_build_object('is_social', NEW.is_social)); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_players() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_players AFTER UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION private.audit_players();

CREATE FUNCTION private.audit_money() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'fine_payments' AND TG_OP = 'INSERT' THEN
    PERFORM private.audit('payment_recorded', NEW.player_id, jsonb_build_object('amount', NEW.amount, 'date', NEW.date)); RETURN NEW;
  ELSIF TG_TABLE_NAME = 'fine_payments' THEN
    PERFORM private.audit('payment_deleted', OLD.player_id, jsonb_build_object('amount', OLD.amount, 'date', OLD.date)); RETURN OLD;
  ELSE
    PERFORM private.audit('fine_deleted', OLD.player_id, jsonb_build_object('amount', OLD.amount, 'date', OLD.date, 'fine_type_id', OLD.fine_type_id)); RETURN OLD;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.audit_money() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_payments AFTER INSERT OR DELETE ON public.fine_payments FOR EACH ROW EXECUTE FUNCTION private.audit_money();
CREATE TRIGGER audit_fines AFTER DELETE ON public.fines FOR EACH ROW EXECUTE FUNCTION private.audit_money();

-- Login events, from Supabase Auth's own table. Exception-safe: never blocks a login.
CREATE FUNCTION private.audit_auth_users() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint;
BEGIN
  SELECT id INTO pid FROM public.players WHERE user_id = NEW.id;
  IF NEW.recovery_sent_at IS DISTINCT FROM OLD.recovery_sent_at AND NEW.recovery_sent_at IS NOT NULL THEN PERFORM private.audit('reset_requested', pid, NULL, pid); END IF;
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password AND NEW.encrypted_password IS NOT NULL THEN PERFORM private.audit('password_changed', pid, NULL, pid); END IF;
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at AND NEW.last_sign_in_at IS NOT NULL THEN PERFORM private.audit('login', pid, NULL, pid); END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN PERFORM private.audit('email_changed', pid, NULL, pid); END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'audit_auth_users: %', SQLERRM; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_auth_users() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_auth_users AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION private.audit_auth_users();

CREATE FUNCTION private.audit_mfa() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint;
BEGIN
  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified') THEN
    SELECT id INTO pid FROM public.players WHERE user_id = NEW.user_id;
    PERFORM private.audit('mfa_enrolled', pid, NULL, pid);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'audit_mfa: %', SQLERRM; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_mfa() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_mfa AFTER INSERT OR UPDATE OF status ON auth.mfa_factors FOR EACH ROW EXECUTE FUNCTION private.audit_mfa();

-- Called by the app right after the authenticator code is accepted; logs only if the caller's own
-- token really is in admin mode.
CREATE FUNCTION public.log_admin_mode() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_admin() THEN RETURN false; END IF;
  PERFORM private.audit('admin_mode_unlocked', private.current_player(), NULL);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.log_admin_mode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_mode() TO authenticated;

-- Link a confirmed login to its player (existing member, matched by email), or create the pending
-- player for a new sign-up. Also tries the email match again on every sign-in of a still-unlinked
-- login, so an admin correcting players.email is enough to fix it — but only confirmation ever
-- creates a player, so a rejected applicant is not recreated by signing in again.
-- Never blocks a login: any error becomes a warning.
CREATE FUNCTION private.link_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint; m jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb); confirming boolean;
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  confirming := CASE WHEN TG_OP = 'INSERT' THEN true ELSE OLD.email_confirmed_at IS NULL END;
  IF NOT confirming AND (NEW.last_sign_in_at IS NULL OR NEW.last_sign_in_at IS NOT DISTINCT FROM OLD.last_sign_in_at) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT id INTO pid FROM public.players
   WHERE lower(email) = lower(NEW.email) AND user_id IS NULL AND archived_at IS NULL ORDER BY id LIMIT 1;
  IF pid IS NOT NULL THEN
    UPDATE public.players SET user_id = NEW.id WHERE id = pid;
    PERFORM private.audit('login_set_up', pid, NULL, pid);
  ELSIF confirming AND m ? 'name' AND NOT EXISTS (SELECT 1 FROM public.players WHERE lower(email) = lower(NEW.email)) THEN
    INSERT INTO public.players (name, email, dgu_number, color, handicap, hcp_history, approved, user_id)
    VALUES (left(m ->> 'name', 60), NEW.email, left(m ->> 'dgu_number', 20), coalesce((m ->> 'color')::int, 0),
            nullif(m ->> 'handicap', '')::numeric,
            CASE WHEN nullif(m ->> 'handicap', '') IS NULL THEN '[]'::jsonb
                 ELSE jsonb_build_array(jsonb_build_object('date', to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD'),
                                        'value', (m ->> 'handicap')::numeric, 'note', 'Sign-up entry')) END,
            false, NEW.id)
    RETURNING id INTO pid;
    PERFORM private.audit('signed_up', pid, NULL, pid);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'link_login: %', SQLERRM; RETURN NEW;
END $$;
CREATE TRIGGER link_login AFTER INSERT OR UPDATE OF email_confirmed_at, last_sign_in_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.link_login();

-- ===== SECTION 3: permission rules for logged-in users ======================================
-- The old PIN route (anon) keeps its allow-all policy until release B; everything below applies to
-- the new login (authenticated). Also covers tables created after enable_rls.sql ran.
-- Old dashboard-made policies ("Public read players", "public write", …) would OR into the p2_*
-- rules and give every logged-in user full access. anon_all (below) already covers the old route,
-- so they go — each one's exact definition is kept in phase2a_backup for the rollback to restore.
CREATE SCHEMA IF NOT EXISTS phase2a_backup;
REVOKE ALL ON SCHEMA phase2a_backup FROM PUBLIC, anon, authenticated;
DROP TABLE IF EXISTS phase2a_backup.legacy_policies;
CREATE TABLE phase2a_backup.legacy_policies AS
  SELECT tablename, policyname, format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s', policyname, tablename,
           permissive, cmd, (SELECT string_agg(quote_ident(r), ', ') FROM unnest(roles) r),
           ' USING (' || qual || ')', ' WITH CHECK (' || with_check || ')') AS def
  FROM pg_policies WHERE schemaname = 'public' AND policyname <> 'anon_all' AND policyname NOT LIKE 'p2_%';
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM phase2a_backup.legacy_policies ORDER BY tablename, policyname LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    INSERT INTO p2_report(line) VALUES ('dropped old policy: ' || r.def);
  END LOOP;
END $$;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'audit_log' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS anon_all ON public.%I', t);
    EXECUTE format('CREATE POLICY anon_all ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
-- players keeps Phase 0's column-level SELECT/UPDATE for authenticated as well
REVOKE SELECT, UPDATE ON public.players FROM authenticated;
GRANT SELECT (id, name, color, handicap, hcp_history, created_at, is_admin, approved, is_social, bag,
              dgu_number, archived_at, legacy_id, user_id) ON public.players TO authenticated;
GRANT UPDATE (name, color, handicap, hcp_history, is_admin, approved, is_social, bag, dgu_number,
              email, archived_at) ON public.players TO authenticated;

-- players
CREATE POLICY p2_players_read   ON public.players FOR SELECT TO authenticated USING (private.is_member() OR user_id = auth.uid());
CREATE POLICY p2_players_update ON public.players FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.is_admin()) WITH CHECK (user_id = auth.uid() OR private.is_admin());
CREATE POLICY p2_players_insert ON public.players FOR INSERT TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY p2_players_delete ON public.players FOR DELETE TO authenticated USING (private.is_admin() AND approved IS FALSE);
-- rounds: members score for their group; pending players only their own
CREATE POLICY p2_rounds_read  ON public.rounds FOR SELECT TO authenticated USING (private.is_member() OR player_id = private.current_player());
CREATE POLICY p2_rounds_write ON public.rounds FOR INSERT TO authenticated WITH CHECK (private.is_member() OR player_id = private.current_player());
CREATE POLICY p2_rounds_upd   ON public.rounds FOR UPDATE TO authenticated USING (private.is_member() OR player_id = private.current_player()) WITH CHECK (private.is_member() OR player_id = private.current_player());
CREATE POLICY p2_rounds_del   ON public.rounds FOR DELETE TO authenticated USING (player_id = private.current_player() OR private.is_admin());
-- fines
CREATE POLICY p2_fines_read ON public.fines FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_fines_ins  ON public.fines FOR INSERT TO authenticated WITH CHECK (private.is_member());
CREATE POLICY p2_fines_upd  ON public.fines FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY p2_fines_del  ON public.fines FOR DELETE TO authenticated USING (private.is_admin());
-- saturday_signups: your own (members only — a pending player may not sign up); admins anyone's
CREATE POLICY p2_signups_read  ON public.saturday_signups FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_signups_write ON public.saturday_signups FOR ALL TO authenticated
  USING ((private.is_member() AND player_id = private.current_player()) OR private.is_admin())
  WITH CHECK ((private.is_member() AND player_id = private.current_player()) OR private.is_admin());
-- The draw fields (group_num, tee_time, date, player_id) are set only in admin mode or via run_draw
-- itself; a member signing up supplies neither, and editing their own row afterward keeps only
-- early_tee_request/early_tee_reason. Without the INSERT half, a member could INSERT their own row
-- with group_num/tee_time already populated — sailing past the UPDATE-only guard entirely, and
-- tripping run_draw's "already drawn" check for everyone. run_draw is SECURITY DEFINER and sets a
-- transaction-local flag (app.drawing) so its own write passes through without the trigger having
-- to depend on the definer's role name, which differs across environments.
CREATE FUNCTION private.protect_signup_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() OR coalesce(current_setting('app.drawing', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.group_num IS NOT NULL OR NEW.tee_time IS NOT NULL THEN
      RAISE EXCEPTION 'Only an admin in admin mode can set the draw.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.group_num IS DISTINCT FROM OLD.group_num OR NEW.tee_time IS DISTINCT FROM OLD.tee_time
     OR NEW.date IS DISTINCT FROM OLD.date OR NEW.player_id IS DISTINCT FROM OLD.player_id THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change the draw.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_signup_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_signup_fields BEFORE INSERT OR UPDATE ON public.saturday_signups FOR EACH ROW EXECUTE FUNCTION private.protect_signup_fields();
-- gps_shots: location data — own only; admins
CREATE POLICY p2_gps ON public.gps_shots FOR ALL TO authenticated
  USING (player_id = private.current_player() OR private.is_admin()) WITH CHECK (player_id = private.current_player() OR private.is_admin());
-- tournaments: members play (update status/results, enter scores); admins set up and delete.
-- Re-entering a score deletes the old row first, so members delete scores too (admins are members).
DO $$ DECLARE t text; p text; BEGIN
  FOREACH t IN ARRAY ARRAY['tournaments','tournament_matches'] LOOP
    p := CASE t WHEN 'tournaments' THEN 'p2_tourn' ELSE 'p2_tmatch' END;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.is_member())', p || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (private.is_member()) WITH CHECK (private.is_member())', p || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin())', p || '_adm', t);
  END LOOP;
END $$;
CREATE POLICY p2_tscore_read ON public.tournament_scores FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_tscore_ins  ON public.tournament_scores FOR INSERT TO authenticated WITH CHECK (private.is_member());
CREATE POLICY p2_tscore_upd  ON public.tournament_scores FOR UPDATE TO authenticated USING (private.is_member()) WITH CHECK (private.is_member());
CREATE POLICY p2_tscore_del  ON public.tournament_scores FOR DELETE TO authenticated USING (private.is_member());
-- read by members, written by admins
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fine_types','fine_payments','saturday_events','tournament_players','tees','green_polygons',
                           'fairway_polygons','fairway_spines','tee_strips','survey_points'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY p2_read ON public.%I FOR SELECT TO authenticated USING (private.is_member())', t);
      EXECUTE format('CREATE POLICY p2_admin ON public.%I FOR ALL TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin())', t);
    END IF;
  END LOOP;
END $$;
-- audit_log: admins read; only private.audit writes
CREATE POLICY p2_audit_read ON public.audit_log FOR SELECT TO authenticated USING (private.is_admin());

-- The draw's clock: always now(). A function of its own only so the tests can pin the time.
CREATE FUNCTION private.draw_clock() RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT now() $$;

-- The Saturday draw: the app computes the fairest allocation (chooseBestDraw); this checks it covers
-- every sign-up for the date exactly once, that group_num/tee_time in the allocation are sane, that
-- the date is the upcoming Saturday and the draw is due (Friday noon through Saturday, Copenhagen
-- time — the same window as the app's autoDrawIfDue), and that the date is not drawn yet, then
-- writes it. Every value in p_alloc comes from the caller (a member's browser), so none of it is
-- trusted as-is. Concurrent calls for one date are serialised by the advisory lock, so two
-- browsers opening the app at the same moment cannot both insert an event and both write groups.
CREATE FUNCTION public.run_draw(p_date text, p_tee_times jsonb, p_alloc jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  want bigint[]; got bigint[];
  ev public.saturday_events%ROWTYPE; ev_found boolean;
  eff_tees jsonb; d date; local_now timestamp; today date; dow int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('run_draw:' || p_date));
  IF auth.uid() IS NOT NULL AND NOT private.is_member() THEN RETURN jsonb_build_object('ok', false, 'reason', 'not a member'); END IF;

  BEGIN
    d := p_date::date;
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid date'); END;
  local_now := private.draw_clock() AT TIME ZONE 'Europe/Copenhagen';
  today := local_now::date; dow := extract(dow FROM today)::int;
  IF d <> today + (6 - dow + 7) % 7 THEN RETURN jsonb_build_object('ok', false, 'reason', 'date is not the upcoming Saturday'); END IF;
  IF NOT (dow = 6 OR (dow = 5 AND extract(hour FROM local_now) >= 12)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not due yet'); END IF;

  -- The effective tee times are the event's own (if it already exists and has some) so a caller
  -- can't smuggle in a tee time that was never offered; otherwise the caller-supplied list, which
  -- must be real — as the app itself falls back to its defaults for an event with none.
  SELECT * INTO ev FROM public.saturday_events WHERE date = p_date FOR UPDATE;
  ev_found := FOUND;
  eff_tees := CASE WHEN ev_found AND jsonb_typeof(ev.tee_times) = 'array' AND jsonb_array_length(ev.tee_times) > 0
                   THEN ev.tee_times ELSE p_tee_times END;
  IF eff_tees IS NULL OR jsonb_typeof(eff_tees) IS DISTINCT FROM 'array' OR jsonb_array_length(eff_tees) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tee times must be a non-empty list'); END IF;

  SELECT array_agg(id ORDER BY id) INTO want FROM public.saturday_signups WHERE date = p_date;
  SELECT array_agg((e ->> 'id')::bigint ORDER BY (e ->> 'id')::bigint) INTO got FROM jsonb_array_elements(p_alloc) e;
  IF want IS NULL OR got IS DISTINCT FROM want THEN RETURN jsonb_build_object('ok', false, 'reason', 'allocation does not match the sign-ups'); END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_alloc) e
             WHERE (e ->> 'group_num') IS NULL OR (e ->> 'group_num') !~ '^[0-9]+$' OR (e ->> 'group_num')::int < 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_num must be a positive integer'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_alloc) e
             WHERE (e ->> 'tee_time') IS NULL OR NOT (eff_tees ? (e ->> 'tee_time'))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tee_time is not one of this event''s tee times'); END IF;

  IF EXISTS (SELECT 1 FROM public.saturday_signups WHERE date = p_date AND group_num IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already drawn'); END IF;
  IF ev_found AND (ev.locked OR ev.cancelled) THEN RETURN jsonb_build_object('ok', false, 'reason', 'locked or cancelled'); END IF;
  IF ev_found THEN UPDATE public.saturday_events SET locked = true, tee_times = eff_tees WHERE id = ev.id;
  ELSE INSERT INTO public.saturday_events (date, locked, tee_times) VALUES (p_date, true, p_tee_times); END IF;
  PERFORM set_config('app.drawing', 'on', true);   -- transaction-local; lets protect_signup_fields through
  UPDATE public.saturday_signups s SET tee_time = e ->> 'tee_time', group_num = (e ->> 'group_num')::int
    FROM jsonb_array_elements(p_alloc) e WHERE s.id = (e ->> 'id')::bigint;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.run_draw(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_draw(text, jsonb, jsonb) TO anon, authenticated;   -- anon until release B

-- Members' emails for admins (the Admin tab's move-over list). Admin mode only.
CREATE FUNCTION public.admin_member_emails() RETURNS TABLE (player_id bigint, name text, email text, linked boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Admin mode required.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT p.id, p.name, coalesce(u.email, p.email), p.user_id IS NOT NULL
    FROM public.players p LEFT JOIN auth.users u ON u.id = p.user_id
   WHERE p.approved IS NOT FALSE AND p.archived_at IS NULL ORDER BY p.user_id IS NOT NULL, p.name;
END $$;
REVOKE ALL ON FUNCTION public.admin_member_emails() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_emails() TO authenticated;

-- Version gate: this release is version 3.
CREATE OR REPLACE FUNCTION public.require_current_app() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text := current_setting('request.headers', true)::json ->> 'x-app-version';
BEGIN
  IF current_user = 'service_role' THEN RETURN; END IF;
  IF coalesce(v, '') !~ '^\d+$' OR v::int < 3 THEN
    RAISE SQLSTATE 'PT426' USING MESSAGE = 'This version of the app is out of date. Please reload the page.';
  END IF;
END $fn$;

-- ===== CHECKS =============================================================================
DO $$ BEGIN
  INSERT INTO p2_report(line) VALUES ('players.user_id added; linked so far: ' || (SELECT count(*) FROM public.players WHERE user_id IS NOT NULL));
END $$;

-- count(DISTINCT trigger_name), not count(*): information_schema.triggers emits one row per
-- firing event, so a multi-event trigger (e.g. "AFTER INSERT OR DELETE") counts twice under
-- plain count(*). DISTINCT is what "count of the 7 named triggers" means.
DO $$ DECLARE n int; BEGIN
  SELECT count(DISTINCT trigger_name) INTO n FROM information_schema.triggers
   WHERE trigger_name IN ('protect_player_fields','audit_players','audit_payments','audit_fines','audit_auth_users','audit_mfa','link_login');
  INSERT INTO p2_report(line) VALUES ('audit triggers: ' || n);
  IF n <> 7 THEN RAISE EXCEPTION 'Expected 7 audit triggers, found %', n; END IF;
END $$;

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'p2_%';
  INSERT INTO p2_report(line) VALUES ('p2_% policies: ' || n);
  IF n < 30 THEN RAISE EXCEPTION 'Expected at least 30 p2_%% policies, found %', n; END IF;
END $$;

-- A leftover permissive policy (e.g. a dashboard-made "Enable read access for all users" TO public
-- or authenticated) would OR into the p2_* rules and silently widen access — the matrix tests can't
-- see it, since they only probe what the intended policies allow. Anything besides anon_all/p2_* is
-- unexpected; name it so the rehearsal (or a real run, which then rolls back too) makes it visible.
DO $$ DECLARE bad text; BEGIN
  SELECT string_agg(schemaname || '.' || tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
    INTO bad FROM pg_policies WHERE schemaname = 'public' AND policyname <> 'anon_all' AND policyname NOT LIKE 'p2_%';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Unexpected polic(y/ies) besides anon_all/p2_*: %', bad; END IF;
END $$;

DO $$ DECLARE n int; expected int; BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND policyname = 'anon_all' AND roles = '{anon}';
  SELECT count(*) INTO expected FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'audit_log';
  INSERT INTO p2_report(line) VALUES ('anon_all policies still TO anon: ' || n || ' of ' || expected || ' public tables (excl. audit_log)');
END $$;

DO $$ BEGIN
  INSERT INTO p2_report(line) VALUES ('version gate: requests need x-app-version >= 3');
END $$;

DO $$ BEGIN
  INSERT INTO p2_report(line) VALUES ('ALL CHECKS PASSED');
END $$;

DO $$ BEGIN
  IF (SELECT rehearsal FROM p2_mode) THEN
    RAISE EXCEPTION E'REHEARSAL OK — everything was rolled back. Report:\n%', (SELECT string_agg(line, E'\n' ORDER BY ord) FROM p2_report);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS private.phase2a_report AS SELECT ord, line FROM p2_report;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
COMMIT;
SELECT line FROM private.phase2a_report ORDER BY ord;
