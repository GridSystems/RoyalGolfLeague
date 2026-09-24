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
-- player for a new sign-up. Never blocks a login: any error becomes a warning.
CREATE FUNCTION private.link_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint; m jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT id INTO pid FROM public.players
   WHERE lower(email) = lower(NEW.email) AND user_id IS NULL AND archived_at IS NULL ORDER BY id LIMIT 1;
  IF pid IS NOT NULL THEN
    UPDATE public.players SET user_id = NEW.id WHERE id = pid;
    PERFORM private.audit('login_set_up', pid, NULL, pid);
  ELSIF m ? 'name' AND NOT EXISTS (SELECT 1 FROM public.players WHERE lower(email) = lower(NEW.email)) THEN
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
CREATE TRIGGER link_login AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.link_login();

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
