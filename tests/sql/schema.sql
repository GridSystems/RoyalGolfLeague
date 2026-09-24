-- Production-shaped schema for the PGlite testbed. Where the repo records a table's DDL it is
-- copied from there (named per table); the rest is as observed through the API on 2026-09-24.
-- The rehearsal on the real database is the final word: if it disagrees with this file, fix
-- this file to match production.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE authenticator; CREATE ROLE service_role;
CREATE TABLE public.players (id bigint PRIMARY KEY, name text, color int, handicap numeric, hcp_history jsonb,
  created_at timestamptz DEFAULT now(), is_admin boolean DEFAULT false, approved boolean DEFAULT true, pin text,
  email text, is_social boolean DEFAULT false, bag jsonb, dgu_number text);
CREATE TABLE public.rounds (id bigint PRIMARY KEY, player_id bigint NOT NULL, course text, date text, tee_id text,
  tee_name text, tee_color text, rating numeric, slope int, hcp_index numeric, course_hcp int, playing_hcp int,
  notes text, holes jsonb, created_at timestamptz DEFAULT now(), tee_time text, marker_id bigint, marker_holes jsonb);
CREATE TABLE public.fine_types (id bigint PRIMARY KEY, name text, amount numeric, created_at timestamptz DEFAULT now(), active boolean DEFAULT true);
CREATE TABLE public.fines (id bigint PRIMARY KEY, player_id bigint NOT NULL, fine_type_id bigint, round_id bigint, hole int,
  date text, issued_by bigint NOT NULL, notes text, created_at timestamptz DEFAULT now(), amount numeric);
-- supabase/add_fine_payments.sql
CREATE TABLE public.fine_payments (id bigint PRIMARY KEY, player_id bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount numeric NOT NULL, date text NOT NULL, note text, recorded_by bigint, created_at timestamptz DEFAULT now());
CREATE TABLE public.saturday_events (id bigint PRIMARY KEY, date text, locked boolean, tee_times jsonb, created_at timestamptz DEFAULT now(), cancelled boolean);
CREATE TABLE public.saturday_signups (id bigint PRIMARY KEY, player_id bigint NOT NULL, date text, tee_time text, group_num int,
  created_at timestamptz DEFAULT now(), early_tee_request boolean, early_tee_reason text);
-- supabase/add_gps_tracking.sql — BIGSERIAL, not identity — plus the columns added since
CREATE TABLE public.gps_shots (id BIGSERIAL PRIMARY KEY, player_id bigint REFERENCES public.players(id) ON DELETE CASCADE,
  round_date date NOT NULL, hole smallint NOT NULL, shot_num smallint NOT NULL, type text NOT NULL DEFAULT 'normal',
  lat double precision, lng double precision, club text, shot_weight text, wind_speed numeric(5,2), wind_dir text,
  wind_deg smallint, result text, recorded_at timestamptz NOT NULL DEFAULT now(), lie text, direction text,
  shot_outcome text, accuracy_m numeric);
-- docs/superpowers/plans/2026-06-28-tournament-mode.md (+ tee_id on matches, added later)
CREATE TABLE public.tournaments (id bigint PRIMARY KEY, name text NOT NULL, date text NOT NULL, tee_id text NOT NULL,
  status text NOT NULL DEFAULT 'setup', team_a_name text NOT NULL DEFAULT 'Team A', team_b_name text NOT NULL DEFAULT 'Team B',
  team_a_captain_id bigint, team_b_captain_id bigint, created_at timestamptz DEFAULT now());
CREATE TABLE public.tournament_players (id bigint PRIMARY KEY, tournament_id bigint NOT NULL REFERENCES public.tournaments(id),
  player_id bigint NOT NULL, team text NOT NULL);
CREATE TABLE public.tournament_matches (id bigint PRIMARY KEY, tournament_id bigint NOT NULL REFERENCES public.tournaments(id),
  round int NOT NULL, match_num int NOT NULL, team_a_p1_id bigint, team_a_p2_id bigint, team_b_p1_id bigint, team_b_p2_id bigint,
  status text NOT NULL DEFAULT 'pending', result text, created_at timestamptz DEFAULT now(), tee_id text);
CREATE TABLE public.tournament_scores (id bigint PRIMARY KEY, match_id bigint NOT NULL REFERENCES public.tournament_matches(id),
  hole int NOT NULL, player_id bigint NOT NULL, gross int NOT NULL);
-- Course tables (mirroring production) that later Phase 2a tasks need.
CREATE TABLE public.tees (id text PRIMARY KEY, name text NOT NULL, color text NOT NULL, rating numeric NOT NULL,
  slope integer NOT NULL, dist jsonb, archived boolean NOT NULL DEFAULT false);
CREATE TABLE public.green_polygons (hole int PRIMARY KEY, vertices jsonb, recorded_at timestamptz DEFAULT now());
CREATE TABLE public.fairway_polygons (hole int PRIMARY KEY, polygons jsonb, recorded_at timestamptz DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
