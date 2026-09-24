-- Royal Golf Club — Phase 0, step 1 of 3: server-side PIN checks
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai). Safe to re-run.
--
-- WHY
-- The app used to download every player's email and PIN and compare them in the
-- browser, so anyone holding the public key could read all of them. These
-- functions do the check inside the database instead. Step 3
-- (phase0b_hide_credentials.sql) then removes the public read access.
--
-- Running this file changes nothing for the live app: it only ADDS functions and
-- two lockout columns. Deploy the app update (step 2) after it, then run step 3.
--
-- NOT FIXED HERE (Phase 2 — real login): the tables are still publicly writable,
-- and admin_reset_pin can be called by anyone, because there is no server-side
-- notion of "admin" yet.

-- Lockout: 5 wrong PINs locks the account for 15 minutes. Without this, hiding
-- the PINs is pointless — a 4-digit PIN falls to 10,000 guesses in minutes.
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS pin_failures int NOT NULL DEFAULT 0;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;

-- Internal: checks a PIN and applies the lockout. Returns 'ok', 'bad', 'locked',
-- 'unset' or 'missing'. Not callable through the API.
CREATE OR REPLACE FUNCTION public._check_pin(p_id bigint, p_pin text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pl public.players%ROWTYPE;
BEGIN
  SELECT * INTO pl FROM public.players WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF pl.pin_locked_until > now() THEN RETURN 'locked'; END IF;
  IF coalesce(pl.pin, '') = '' THEN RETURN 'unset'; END IF;
  IF pl.pin = p_pin THEN
    UPDATE public.players SET pin_failures = 0, pin_locked_until = NULL WHERE id = p_id;
    RETURN 'ok';
  END IF;
  UPDATE public.players SET
    pin_failures     = CASE WHEN pin_failures + 1 >= 5 THEN 0 ELSE pin_failures + 1 END,
    pin_locked_until = CASE WHEN pin_failures + 1 >= 5 THEN now() + interval '15 minutes' END
  WHERE id = p_id;
  RETURN 'bad';
END $$;
REVOKE ALL ON FUNCTION public._check_pin(bigint, text) FROM PUBLIC, anon, authenticated;

-- Email + PIN login. Returns {ok, id, name, needs_pin, locked}. An unknown email
-- and a wrong PIN return the same answer, so the login screen can't be used to
-- find out who is a member.
CREATE OR REPLACE FUNCTION public.login(p_email text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pl public.players%ROWTYPE; res text;
BEGIN
  SELECT * INTO pl FROM public.players WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  res := public._check_pin(pl.id, p_pin);
  IF res = 'unset' THEN RETURN jsonb_build_object('ok', true, 'id', pl.id, 'name', pl.name, 'needs_pin', true); END IF;
  IF res = 'ok'    THEN RETURN jsonb_build_object('ok', true, 'id', pl.id, 'name', pl.name); END IF;
  RETURN jsonb_build_object('ok', false, 'locked', res = 'locked');
END $$;

-- Whether a player has a PIN yet (the player picker needs to know which form to show).
CREATE OR REPLACE FUNCTION public.has_pin(p_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(pin, '') <> '' FROM public.players WHERE id = p_id;
$$;

-- PIN check for switching player on a shared device. Returns {ok, locked}.
CREATE OR REPLACE FUNCTION public.check_pin(p_id bigint, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res text := public._check_pin(p_id, p_pin);
BEGIN
  RETURN jsonb_build_object('ok', res = 'ok', 'locked', res = 'locked');
END $$;

-- First PIN for a player who has none (new, or reset by an admin). Requires the
-- player's email, so knowing someone's public player id is not enough.
CREATE OR REPLACE FUNCTION public.set_first_pin(p_id bigint, p_email text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_pin !~ '^\d{4}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'PIN must be 4 digits.'); END IF;
  UPDATE public.players SET pin = p_pin, pin_failures = 0, pin_locked_until = NULL
   WHERE id = p_id AND lower(email) = lower(trim(p_email)) AND coalesce(pin, '') = '';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'That email does not match this player, or a PIN is already set.'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Admin "Reset PIN". Open to anyone until Phase 2 adds real admin login — but a
-- reset PIN can only be re-set by someone who knows the player's email.
CREATE OR REPLACE FUNCTION public.admin_reset_pin(p_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.players SET pin = NULL, pin_failures = 0, pin_locked_until = NULL WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.login(text, text)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_pin(bigint)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_pin(bigint, text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_first_pin(bigint, text, text)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_pin(bigint)             TO anon, authenticated;

-- Make PostgREST see the new functions immediately.
NOTIFY pgrst, 'reload schema';
