# Nightingale Pilot Runtime

This directory is intentionally separate from the local synthetic Demo. It is the Foundation for a single-clinic Pilot and must not run against unrestricted PHI until the Pilot Gate is complete.

## Pilot Web service

Start the independently routed Pilot service on port 3001:

```bash
npm run pilot:dev
```

`GET /api/health` confirms the service is running. `POST /api/care-entries` requires a verified OIDC bearer token and accepts only `clinicId`, `patientId`, `type` (`staff_note` or `clinician_note`), and `content`. `PATCH /api/care-entries/:entryId` requires `clinicId`, `expectedVersion`, and `content`; a stale version returns `409 VERSION_CONFLICT`.

Review Tasks remain clinic-scoped: `PATCH /api/review-tasks/:taskId/claim` lets an authenticated clinic member claim an open task. `PATCH /api/review-tasks/:taskId/close` requires a clinician and one structured closure reason: `clinician_confirmed`, `clinician_rejected`, `not_clinically_relevant`, `source_outdated`, or `rule_false_positive`. The service is deliberately separate from the synthetic Demo on port 3000.

The Evidence Workbench is source-linked: `GET /api/highlights/:highlightId?clinicId=:clinicId` returns the Claim, exact source span, configuration versions, and current Evidence State. `PATCH /api/highlights/:highlightId` allows a clinician to accept, reject, pin, or dismiss a Highlight; only acceptance marks the linked Claim `clinician-confirmed`. Dismissal requires one structured reason: `not_clinically_relevant`, `source_outdated`, or `rule_false_positive`.

`GET /api/patients/:patientId/care-note?clinicId=:clinicId` returns the clinic-scoped Care Note read model: current Timeline Entry versions, source-linked Highlights, and open or claimed tasks. It never falls back to another Clinic's patient record.

## Governed AI Intake foundation

The Pilot has a server-side redaction utility, strict extraction schema validation, and deterministic risk rules for allergy-medication conflicts, breathing difficulty, and overdue renal follow-up. These rules create reviewable signals from validated Claims; they do not use a model risk score or self-reported confidence. Run `npm run test:pilot-rules` to verify the deterministic contract. A model adapter and worker persistence path remain intentionally unconfigured until a provider, data-processing agreement, and redaction regression corpus are approved.

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

Verify the first authenticated Care Note mutation in an isolated temporary database:

```bash
npm run test:pilot-workflow
```

It verifies a clinician can create an internal Timeline Entry only for a patient in their Clinic, and that its initial immutable version, audit event, and Outbox Event commit together.

## Before any Pilot data

1. Connect a managed identity provider and verify JWT issuer, audience, expiration, and subject.
2. Use a restricted database role with `BYPASSRLS` explicitly prohibited.
3. Run tenant-escape, stale-write, audit-immutability, and outbox atomicity tests against Postgres.
4. Complete the Pilot Gate in the root `CONTEXT.md`.
