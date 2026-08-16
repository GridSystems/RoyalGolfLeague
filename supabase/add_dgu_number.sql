-- Add DGU membership number to players
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run.

-- Nullable on purpose: every existing player has no number, and NOT NULL would
-- invalidate all existing rows. "Required" is enforced at the sign-up form.
-- TEXT, not numeric: the value contains a hyphen and may have leading zeros.
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS dgu_number TEXT;

-- Grant already covered by grants.sql but included here for completeness
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO anon, authenticated;
