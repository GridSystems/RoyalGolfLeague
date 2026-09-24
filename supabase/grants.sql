-- Royal Golf Club — explicit Data API grants
-- Run once in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (GRANT is idempotent).
--
-- Required because from Oct 30 2026 Supabase no longer auto-grants
-- public schema tables to anon / authenticated for existing projects.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- players: SELECT and UPDATE are column-level so email and PIN stay hidden (Phase 0,
-- see phase0b_hide_credentials.sql). Never grant them table-wide here.
GRANT INSERT, DELETE ON public.players TO anon, authenticated;
GRANT SELECT (id, name, color, handicap, hcp_history, created_at, is_admin, approved,
              is_social, bag, dgu_number) ON public.players TO anon, authenticated;
GRANT UPDATE (name, color, handicap, hcp_history, is_admin, approved, is_social, bag,
              dgu_number, email) ON public.players TO anon, authenticated;
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
