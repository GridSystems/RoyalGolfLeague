-- Royal Golf Club — enable RLS with permissive policies
-- Run once in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (drops+recreates the policy each time).
--
-- WHY
-- Supabase's Security Advisor emails a warning for every public table that has
-- RLS disabled. This project intentionally ran with RLS off. Because the app
-- has NO auth layer, the anon role legitimately needs full CRUD on every table,
-- so we enable RLS and attach an allow-all policy for anon + authenticated.
--
-- HONEST NOTE: this SATISFIES THE LINTER but does NOT add real security — the
-- anon key is public (it ships in index.html), and these policies let it do
-- everything, exactly as before. Real protection requires an auth layer
-- (Supabase Auth or moving writes behind an Edge Function). That's a separate,
-- future piece of work. This script only stops the warning emails.

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS anon_all ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY anon_all ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;

-- Verify: every public table should show rowsecurity = true.
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
