# Nightingale Pilot Runtime

This directory is intentionally separate from the local synthetic Demo. It is the Foundation for a single-clinic Pilot and must not run against unrestricted PHI until the Pilot Gate is complete.

## Foundation contract

- Managed identity verifies the subject before every database transaction.
- The application sets `SET LOCAL app.user_id = '<verified UUID>'` only after verification.
- Postgres Row-Level Security checks Clinic Membership independently of application code.
- A Care Entry version is appended through `append_entry_version`, which locks the entry, checks the expected version, writes the new version, audit event, and outbox event in one transaction.
- Database roles used by the web application are not allowed to bypass RLS.

## Local foundation database

```bash
docker compose -f pilot-runtime/docker-compose.yml up -d
psql "$PILOT_ADMIN_DATABASE_URL" -f pilot-runtime/db/migrations/0000_security_roles.sql
psql "$PILOT_ADMIN_DATABASE_URL" -f pilot-runtime/db/migrations/0001_foundation.sql
```

The web service then uses `PILOT_DATABASE_URL` for the restricted `nightingale_web` role. Neither URL is provided in source control. See `.env.example` for the required variables. Local database credentials are for synthetic or de-identified development data only.

## Before any Pilot data

1. Connect a managed identity provider and verify JWT issuer, audience, expiration, and subject.
2. Use a restricted database role with `BYPASSRLS` explicitly prohibited.
3. Run tenant-escape, stale-write, audit-immutability, and outbox atomicity tests against Postgres.
4. Complete the Pilot Gate in the root `CONTEXT.md`.
