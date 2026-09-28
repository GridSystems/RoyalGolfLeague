-- Royal Golf Club — "Finish signing up" for a login with no player (2026-09-28).
-- Someone new who used "Set it up" (for existing members) instead of "Sign up" gets a confirmed
-- login with no name, so link_login creates no player and they are stuck on "isn't linked".
-- public.complete_signup lets that login create its own pending player from the app. The
-- "create a pending player" step moves out of link_login into private.create_pending, shared by both.
-- Run in the Supabase SQL Editor. Needs phase2a_auth.sql, which carries the same functions.
-- Safe to re-run. Undo: phase2a_auth.sql's link_login as it was (git history) and
--   DROP FUNCTION public.complete_signup(text, text, numeric, int);
--   DROP FUNCTION private.create_pending(uuid, text, jsonb);
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('private.link_login()') IS NULL THEN
    RAISE EXCEPTION 'phase2a_auth.sql must be applied first. Nothing was changed.';
  END IF;
END $$;

-- A new pending player for a login, from sign-up details m (name, dgu_number, handicap, color).
-- Never a second player for an email already on file: returns NULL then. Shared by link_login and
-- complete_signup, so the two ways in can't drift apart.
CREATE OR REPLACE FUNCTION private.create_pending(p_user uuid, p_email text, m jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.players WHERE lower(email) = lower(p_email)) THEN RETURN NULL; END IF;
  INSERT INTO public.players (name, email, dgu_number, color, handicap, hcp_history, approved, user_id)
  VALUES (left(m ->> 'name', 60), p_email, left(m ->> 'dgu_number', 20), coalesce((m ->> 'color')::int, 0),
          nullif(m ->> 'handicap', '')::numeric,
          CASE WHEN nullif(m ->> 'handicap', '') IS NULL THEN '[]'::jsonb
               ELSE jsonb_build_array(jsonb_build_object('date', to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD'),
                                      'value', (m ->> 'handicap')::numeric, 'note', 'Sign-up entry')) END,
          false, p_user)
  RETURNING id INTO pid;
  PERFORM private.audit('signed_up', pid, NULL, pid);
  RETURN pid;
END $$;
REVOKE ALL ON FUNCTION private.create_pending(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Link a confirmed login to its player (existing member, matched by email), or create the pending
-- player for a new sign-up. Also tries the email match again on every sign-in of a still-unlinked
-- login, so an admin correcting players.email is enough to fix it — but only confirmation ever
-- creates a player, so a rejected applicant is not recreated by signing in again.
-- Never blocks a login: any error becomes a warning.
CREATE OR REPLACE FUNCTION private.link_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  ELSIF confirming AND m ? 'name' THEN
    PERFORM private.create_pending(NEW.id, NEW.email, m);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'link_login: %', SQLERRM; RETURN NEW;
END $$;

-- "Finish signing up": a signed-in login with no player (it came in by "Set it up", so carried no
-- name) creates its own pending player. Only ever creates: an email already on file is linked by
-- link_login at the next sign-in, or needs an admin.
CREATE OR REPLACE FUNCTION public.complete_signup(p_name text, p_dgu text, p_handicap numeric, p_color int) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE em text; pid bigint;
BEGIN
  SELECT email INTO em FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF em IS NULL THEN RAISE EXCEPTION 'Confirm your email first, then sign in again.'; END IF;
  SELECT id INTO pid FROM public.players WHERE user_id = auth.uid();
  IF pid IS NOT NULL THEN RETURN pid; END IF;
  IF coalesce(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Please enter your name.'; END IF;
  pid := private.create_pending(auth.uid(), em,
    jsonb_build_object('name', btrim(p_name), 'dgu_number', btrim(p_dgu), 'handicap', p_handicap, 'color', p_color));
  IF pid IS NULL THEN RAISE EXCEPTION 'Your email is already on file for a player. Sign out and sign in again; if you are still not linked, ask an admin.'; END IF;
  RETURN pid;
END $$;
REVOKE ALL ON FUNCTION public.complete_signup(text, text, numeric, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_signup(text, text, numeric, int) TO authenticated;
COMMIT;
