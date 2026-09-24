-- Royal Golf Club — Phase 1 cleanup. Run a week after go-live, once nothing looks wrong.
-- After this, phase1_rollback.sql no longer works.
DROP SCHEMA IF EXISTS phase1_backup CASCADE;
