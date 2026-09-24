-- Royal Golf Club — remove the read-only reporting login (readonly_user)
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). Safe to re-run.
--
-- It was a direct database login (created by the old readonly_role.sql) that nobody uses
-- any more. It could read member data, so it goes. DROP OWNED BY revokes every privilege
-- it holds (it owns no objects), then the role itself is dropped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_user') THEN
    DROP OWNED BY readonly_user;
    DROP ROLE readonly_user;
    RAISE NOTICE 'readonly_user removed';
  ELSE
    RAISE NOTICE 'readonly_user did not exist — nothing to do';
  END IF;
END $$;

-- Verify (expect no rows):
-- SELECT rolname FROM pg_roles WHERE rolname = 'readonly_user';
