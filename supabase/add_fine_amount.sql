-- Royal Golf Club — snapshot the fine amount at issue time
-- Run once in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run.
--
-- WHY
-- fines stored only fine_type_id, so every total was computed against the CURRENT
-- fine_types.amount. Editing an amount silently rewrote history: change "Late on Tee"
-- from 10 to 20 and every Late on Tee fine ever issued became 20, back to April.
-- After this, each fine carries the amount it was issued at, and fine_types.amount
-- only affects fines issued from that point on — i.e. the rest of the season.
--
-- ORDER OF OPERATIONS — IMPORTANT
-- Run this BEFORE changing any fine type amounts. The backfill freezes existing fines
-- at whatever the amounts are RIGHT NOW. It cannot recover an amount that was already
-- edited (that history is not recorded anywhere).
--
-- No GRANT needed: new columns inherit the table-level grants in grants.sql.

ALTER TABLE public.fines ADD COLUMN IF NOT EXISTS amount numeric;

-- Freeze existing fines at their fine type's current amount.
UPDATE public.fines f
SET    amount = ft.amount
FROM   public.fine_types ft
WHERE  f.fine_type_id = ft.id
  AND  f.amount IS NULL;

-- Orphans (fine type deleted) fall back to the historic default the app used.
UPDATE public.fines
SET    amount = 10
WHERE  amount IS NULL;

-- Verify: expect zero rows.
-- SELECT count(*) AS unpriced_fines FROM public.fines WHERE amount IS NULL;
