-- Royal Golf Club — Phase 2 release B2. Run a week after phase2b_enforce.sql, once nothing looks wrong.
-- Drops the PIN functions, the players columns pin, pin_failures, pin_locked_until and legacy_id, and
-- schema phase2b_backup. After this, phase2b_rollback.sql no longer works and the PIN login can't
-- come back. players.email and players.user_id stay. phase2a_rollback.sql can no longer be re-applied
-- after this. One transaction: it all happens or none of it.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='anon_all') THEN
    RAISE EXCEPTION 'Run phase2b_enforce.sql first. Nothing was changed.';
  END IF;
END $$;

-- The one live function that read legacy_id: same as phase2a_auth.sql, minus that comparison.
CREATE OR REPLACE FUNCTION private.protect_player_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() THEN RETURN NEW; END IF;
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.is_social IS DISTINCT FROM OLD.is_social OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change that.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_player_fields() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('login', 'has_pin', 'check_pin', 'set_first_pin', 'admin_reset_pin', '_check_pin') LOOP
    EXECUTE format('DROP FUNCTION %s', f);
  END LOOP;
END $$;

ALTER TABLE public.players DROP COLUMN IF EXISTS pin, DROP COLUMN IF EXISTS pin_failures,
  DROP COLUMN IF EXISTS pin_locked_until, DROP COLUMN IF EXISTS legacy_id;
DROP SCHEMA IF EXISTS phase2b_backup CASCADE;
NOTIFY pgrst, 'reload schema';
COMMIT;
