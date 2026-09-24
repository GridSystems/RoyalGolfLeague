-- Royal Golf Club — explicit Data API grants
-- Run once in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (GRANT is idempotent).
--
-- Required because from Oct 30 2026 Supabase no longer auto-grants
-- public schema tables to anon / authenticated for existing projects.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- players: SELECT and UPDATE are column-level so email and PIN stay hidden (Phase 0,
-- see phase0b_hide_credentials.sql). Never grant them table-wide here.
-- user_id (Phase 2 release A, see phase2a_auth.sql) links a login to its player row;
-- it is readable the same as the rest of the roster.
GRANT INSERT, DELETE ON public.players TO anon, authenticated;
GRANT SELECT (id, name, color, handicap, hcp_history, created_at, is_admin, approved,
              is_social, bag, dgu_number, archived_at, legacy_id, user_id) ON public.players TO anon, authenticated;
GRANT UPDATE (name, color, handicap, hcp_history, is_admin, approved, is_social, bag,
              dgu_number, email, archived_at) ON public.players TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rounds           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fines            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fine_types       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fine_payments    TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saturday_events  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saturday_signups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gps_shots        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_points    TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.green_polygons   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tees             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_players  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_matches  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_scores   TO anon, authenticated;

-- Phase 1: ids are identity columns; keep sequence usage explicit.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Phase 2 release A (see phase2a_auth.sql): audit_log rows are readable only by an
-- authenticated admin — the SELECT grant below is table-wide on purpose, RLS (p2_audit_read)
-- is what actually decides which rows come back. anon has no grant on this table at all.
GRANT SELECT ON public.audit_log TO authenticated;

-- The `private` schema (private.current_player, private.acting_player, private.is_member,
-- private.is_admin, private.audit, and the trigger functions) is not part of the Data API and
-- has no grants here. It is SECURITY DEFINER, called only from triggers, RLS policies and the
-- public.run_draw / public.log_admin_mode / public.admin_member_emails functions, whose own
-- EXECUTE grants are set in phase2a_auth.sql alongside the schema they belong to.
