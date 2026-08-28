-- Run once as the managed Postgres administrator, before 0001_foundation.sql.
-- The Pilot web service connects as nightingale_web. It is never the table owner.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nightingale_owner') THEN
    CREATE ROLE nightingale_owner NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nightingale_web') THEN
    CREATE ROLE nightingale_web LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nightingale_worker') THEN
    CREATE ROLE nightingale_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;

REVOKE ALL ON DATABASE nightingale_pilot FROM PUBLIC;
GRANT CONNECT ON DATABASE nightingale_pilot TO nightingale_web, nightingale_worker;
GRANT nightingale_owner TO CURRENT_USER;

-- The Docker-created database starts with the bootstrap administrator owning
-- public. Transfer that ownership before 0001 switches to nightingale_owner;
-- otherwise the restricted migration role cannot create the Pilot schema.
ALTER SCHEMA public OWNER TO nightingale_owner;
