-- PostgreSQL requires this new enum value to commit before later migrations
-- may safely use it in database functions.
BEGIN;
SET LOCAL ROLE nightingale_owner;
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'system';
RESET ROLE;
COMMIT;
