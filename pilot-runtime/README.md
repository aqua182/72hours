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
bash pilot-runtime/scripts/setup-postgres.sh
```

The web service then uses `PILOT_DATABASE_URL` for the restricted `nightingale_web` role. Neither URL is provided in source control. The wizard creates the required `pilot-runtime/.env`. Local database credentials are for synthetic or de-identified development data only.

Verify clinic isolation after the local database is ready:

```bash
npm run test:pilot-isolation
```

The test creates two synthetic clinics, verifies cross-clinic reads and writes are denied, confirms Timeline Entry versions cannot be mutated directly, and removes its fixtures before it exits.

## Before any Pilot data

1. Connect a managed identity provider and verify JWT issuer, audience, expiration, and subject.
2. Use a restricted database role with `BYPASSRLS` explicitly prohibited.
3. Run tenant-escape, stale-write, audit-immutability, and outbox atomicity tests against Postgres.
4. Complete the Pilot Gate in the root `CONTEXT.md`.
