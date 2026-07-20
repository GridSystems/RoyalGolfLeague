-- Royal Golf Club — fine payments ledger
-- Run once in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run.
--
-- WHY
-- Fines are only ever issued; nothing recorded what a player has PAID back.
-- Players settle up in lump sums via the MobilePay box, so a payment is not
-- tied to any single fine. This is a plain ledger: one row per payment.
-- Outstanding balance per player = SUM(fines.amount) - SUM(fine_payments.amount).
--
-- id is a Date.now()+random bigint set by the app, matching fines/players.

CREATE TABLE IF NOT EXISTS public.fine_payments (
  id          bigint PRIMARY KEY,
  player_id   bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount      numeric NOT NULL,
  date        text NOT NULL,            -- YYYY-MM-DD
  note        text,
  recorded_by bigint,                   -- player id of the admin who logged it
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fine_payments_player_idx ON public.fine_payments(player_id);

-- Data API grant (required — see grants.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fine_payments TO anon, authenticated;
