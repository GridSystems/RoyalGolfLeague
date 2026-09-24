-- Royal Golf Club — undo season_entries.sql. Entries (and who paid) are lost; the audit log keeps
-- its entry_paid rows. Redeploy the previous app straight after. Safe to re-run.
BEGIN;
DROP TABLE IF EXISTS public.season_entries;
DROP FUNCTION IF EXISTS private.audit_entries();
NOTIFY pgrst, 'reload schema';
COMMIT;
