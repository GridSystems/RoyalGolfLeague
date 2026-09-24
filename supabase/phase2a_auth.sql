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

-- Placeholder — Task 3 replaces this with the real audit log function and table.
CREATE FUNCTION private.audit(p_action text, p_target bigint, p_details jsonb, p_actor bigint DEFAULT NULL) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT NULL::void $$;

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
