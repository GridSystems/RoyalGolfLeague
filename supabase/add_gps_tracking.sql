-- Royal Golf Club — GPS Tracking tables
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (IF NOT EXISTS guards).

-- 1. gps_shots table
CREATE TABLE IF NOT EXISTS public.gps_shots (
  id           BIGSERIAL PRIMARY KEY,
  player_id    INTEGER REFERENCES public.players(id) ON DELETE CASCADE,
  round_date   DATE NOT NULL,
  hole         SMALLINT NOT NULL CHECK (hole BETWEEN 1 AND 18),
  shot_num     SMALLINT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'normal'
               CHECK (type IN ('normal','replay','drop','provisional')),
  lat          DOUBLE PRECISION,   -- NULL for chip/putt (GPS suppressed)
  lng          DOUBLE PRECISION,   -- NULL for chip/putt
  club         TEXT,
  shot_weight  TEXT CHECK (shot_weight IN ('full','3/4','1/2','chip','putt')),
  wind_speed   NUMERIC(5,2),
  wind_dir     TEXT,
  wind_deg     SMALLINT,
  result       TEXT DEFAULT NULL,  -- TBC: post-shot sentiment
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gps_shots TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.gps_shots_id_seq TO authenticated;

-- RLS is disabled to match all other tables in this project
-- (app uses anon key with client-side player selection — no server-side auth)
ALTER TABLE public.gps_shots DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_gps_shots_player_id ON public.gps_shots(player_id);
CREATE INDEX IF NOT EXISTS idx_gps_shots_player_round_hole ON public.gps_shots(player_id, round_date, hole);

-- 2. bag column on players
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS bag JSONB NOT NULL DEFAULT '[]';
