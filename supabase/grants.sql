-- Royal Golf Club — explicit Data API grants
-- Run once in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (GRANT is idempotent).
--
-- Required because from Oct 30 2026 Supabase no longer auto-grants
-- public schema tables to anon / authenticated for existing projects.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.players          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rounds           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fines            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fine_types       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saturday_events  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saturday_signups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gps_shots        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_points TO anon, authenticated;
