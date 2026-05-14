-- Add Social Member flag to players
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS is_social BOOLEAN NOT NULL DEFAULT FALSE;

-- Grant already covered by grants.sql but included here for completeness
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO anon, authenticated;
