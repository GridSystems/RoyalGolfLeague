-- Royal Golf Club — explicit Data API grants
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (GRANT is idempotent).
--
-- Required because from Oct 30 2026 Supabase no longer auto-grants
-- public schema tables to authenticated for existing projects.
--
-- anon has NO access to anything here since release B (phase2b_enforce.sql). Never grant it
-- anything in this file: re-running it would hand back what release B took away. The only thing
-- anon may touch is public.require_current_app() (the version gate).

BEGIN;
-- A table without row level security would be wide open to every member once granted below.
DO $$ DECLARE bad text; BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Table(s) without row level security: %. Enable RLS and add p2_* policies first. Nothing was granted.', bad;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated;

-- Every table but audit_log and players, so a new table can't be missed. RLS (the p2_* policies)
-- decides which rows each member sees.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('audit_log', 'players') LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- players: SELECT and UPDATE are column-level so email and the lockout/PIN history stay hidden
-- (Phase 0, see phase0b_hide_credentials.sql). Never grant them table-wide here. Same lists as
-- phase2a_auth.sql, minus legacy_id (dropped by phase2b_cleanup.sql).
-- user_id (Phase 2 release A) links a login to its player row; readable like the rest of the roster.
GRANT INSERT, DELETE ON public.players TO authenticated;
GRANT SELECT (id, name, color, handicap, hcp_history, created_at, is_admin, approved,
              is_social, bag, dgu_number, archived_at, user_id) ON public.players TO authenticated;
GRANT UPDATE (name, color, handicap, hcp_history, is_admin, approved, is_social, bag,
              dgu_number, email, archived_at) ON public.players TO authenticated;

-- Phase 1: ids are identity columns; keep sequence usage explicit.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Phase 2 release A (see phase2a_auth.sql): audit_log rows are readable only by an
-- authenticated admin — the SELECT grant below is table-wide on purpose, RLS (p2_audit_read)
-- is what actually decides which rows come back.
GRANT SELECT ON public.audit_log TO authenticated;

-- The `private` schema (private.current_player, private.acting_player, private.is_member,
-- private.is_admin, private.audit, and the trigger functions) is not part of the Data API and
-- has no grants here. It is SECURITY DEFINER, called only from triggers, RLS policies and the
-- public.run_draw / public.log_admin_mode / public.admin_member_emails functions, whose own
-- EXECUTE grants are set in phase2a_auth.sql alongside the schema they belong to.
COMMIT;
