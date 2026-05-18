-- Royal Golf Club — Read-only database role
-- Run once in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (CREATE ROLE IF NOT EXISTS).
--
-- After running, share the connection string from:
--   Supabase → Settings → Database → Connection string (Session mode / port 5432)
-- Replace [YOUR-PASSWORD] in the string with the password set below.

CREATE ROLE readonly_user LOGIN PASSWORD 'CHANGE_ME' CONNECTION LIMIT 5;

GRANT USAGE ON SCHEMA public TO readonly_user;

GRANT SELECT ON public.players          TO readonly_user;
GRANT SELECT ON public.rounds           TO readonly_user;
GRANT SELECT ON public.fines            TO readonly_user;
GRANT SELECT ON public.fine_types       TO readonly_user;
GRANT SELECT ON public.saturday_events  TO readonly_user;
GRANT SELECT ON public.saturday_signups TO readonly_user;
