-- Royal Golf Club — Phase 0, step 3 of 3: hide email and PIN
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai) AFTER
-- phase0a_pin_functions.sql has run and the app update is live. Safe to re-run.
--
-- Swaps table-wide access on players for column lists that leave out email, pin
-- and the lockout columns. Login goes through public.login() instead.
--
-- Keep grants.sql in step with this file: re-running an old grants.sql
-- (table-wide SELECT on players) would silently undo it.

-- Read: everything except the credentials.
REVOKE SELECT ON public.players FROM anon, authenticated;
GRANT SELECT (id, name, color, handicap, hcp_history, created_at, is_admin, approved,
              is_social, bag, dgu_number)
  ON public.players TO anon, authenticated;

-- Write: email can still be changed (sign-up, admin "Edit email"), but PINs and the
-- lockout only change through the phase0a functions. INSERT stays table-wide
-- because sign-up sets the first PIN.
REVOKE UPDATE ON public.players FROM anon, authenticated;
GRANT UPDATE (name, color, handicap, hcp_history, is_admin, approved, is_social, bag,
              dgu_number, email)
  ON public.players TO anon, authenticated;

-- The read-only reporting login (readonly_role.sql) could read PINs too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_user') THEN
    REVOKE SELECT ON public.players FROM readonly_user;
    GRANT SELECT (id, name, color, handicap, hcp_history, created_at, is_admin, approved,
                  is_social, bag, dgu_number)
      ON public.players TO readonly_user;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify (should list no email / pin / pin_* rows for anon):
-- SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
--  WHERE table_name = 'players' AND grantee IN ('anon','readonly_user') ORDER BY 1,2,3;
