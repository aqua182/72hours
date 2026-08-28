# Nightingale Pilot Runtime

This directory is intentionally separate from the local synthetic Demo. It is the Foundation for a single-clinic Pilot and must not run against unrestricted PHI until the Pilot Gate is complete.

## Pilot Web service

Start the independently routed Pilot service on port 3001:

```bash
npm run pilot:dev
```

Open `http://localhost:3001` to use the real Auth0 browser login. The Pilot
uses Auth0's server-side session to obtain an API access token, validates that
token's issuer, audience, signature, and subject, and only then opens an
RLS-scoped database transaction. A successful login does not grant patient
access: a Pilot administrator must separately create the user's active Clinic
Membership. `/auth/login`, `/auth/logout`, and `/auth/callback` are mounted by
the Pilot's Next.js Proxy; this service never uses the synthetic Demo role
switcher.

### Submission-demo bootstrap

For the local synthetic demonstration, provision the already-authenticated
Auth0 user through the administrator-only CLI. Get the user subject from
Auth0 **User Management → Users → user details → User ID**; do not paste it
into chat. This command creates or reuses the named local Clinic, grants the
selected Membership, and creates the Ava Tan synthetic Care Note exactly once.

```bash
npm run pilot:provision -- "<Auth0 User ID>" "Pilot Clinician" "Nightingale Pilot Dev" clinician
```

For the separate patient-facing demonstration, create an Auth0 test user and
grant it access only to the existing Ava Tan synthetic patient portal (not a
Clinic Membership):

```bash
npm run pilot:provision-patient -- "<Auth0 User ID>" "Pilot Patient" "Nightingale Pilot Dev"
```

The command uses `PILOT_ADMIN_DATABASE_URL` only on the local machine. The
browser service continues to use only `PILOT_DATABASE_URL`, the restricted web
role. Reload `http://localhost:3001` after it completes. A signed-in user with
no active Membership sees no patient material and receives `NOT_PROVISIONED`
from `GET /api/memberships`.

Use the [submission recording runbook](docs/DEMO-RUNBOOK.md) to record the
three-minute workflow demonstration without exposing credentials or real data.

After you create the Auth0 Regular Web Application and API, run:

```bash
bash pilot-runtime/scripts/setup-auth0.sh
```

The wizard stores the Auth0 Domain, API Identifier, and client/session secrets
only in the ignored `pilot-runtime/.env` file. Do not copy its secrets into
source control or chat. It always switches to the Pilot directory first, so it
is safe to run from the repository root. Verify session-to-token authorization
behavior with:

```bash
npm run test:pilot-auth
npm run test:pilot-memberships
```

`GET /api/health` confirms the service is running. `POST /api/care-entries` requires a verified OIDC bearer token and accepts only `clinicId`, `patientId`, `type` (`staff_note` or `clinician_note`), and `content`. `PATCH /api/care-entries/:entryId` requires `clinicId`, `expectedVersion`, and `content`; a stale version returns `409 VERSION_CONFLICT`.

Review Tasks remain clinic-scoped: `PATCH /api/review-tasks/:taskId/claim` lets an authenticated clinic member claim an open task. `PATCH /api/review-tasks/:taskId/close` requires a clinician and one structured closure reason: `clinician_confirmed`, `clinician_rejected`, `not_clinically_relevant`, `source_outdated`, or `rule_false_positive`. The service is deliberately separate from the synthetic Demo on port 3000.

The Evidence Workbench is source-linked: `GET /api/highlights/:highlightId?clinicId=:clinicId` returns the Claim, exact source span, configuration versions, and current Evidence State. `PATCH /api/highlights/:highlightId` allows a clinician to accept, reject, pin, or dismiss a Highlight; only acceptance marks the linked Claim `clinician-confirmed`. Dismissal requires one structured reason: `not_clinically_relevant`, `source_outdated`, or `rule_false_positive`.

### Collaboration and longitudinal review

- `POST`/`GET /api/care-entries/:entryId/comments` creates or reads internal
  threaded comments with a parent, mention, and assignment constrained to an
  active Clinic Member. `PATCH /api/comments/:commentId` resolves or reopens one.
- `GET /api/care-entries/:entryId/versions` lists immutable snapshots.
  `POST /api/care-entries/:entryId/revert` restores an historic snapshot only
  by appending a new version and audit event.
- `POST /api/ai-scribed-entries` redacts direct identifiers before storage or
  model submission, then creates a distinct system-authored doctor, nurse or
  AI-patient draft, immutable source pointer, Claim and review Highlight.
- `POST /api/patient-insights` creates a patient-authored internal Timeline
  Entry only when the signed-in user has the separate patient portal grant.
  `GET /api/patient-insights` returns only that signed-in patient's own
  submitted text as a receipt; it never returns internal care-team content.
- `POST /api/patients/:patientId/patient-summary` lets a clinician publish a
  plain-language summary. `GET /api/patient-summaries` is the separate patient
  endpoint; it never returns raw AI entries, internal notes, comments, claims,
  tasks or Highlights.

The Glance page subscribes to a content-free Server-Sent Event signal and
re-fetches its already-authorized read model when a Care Note changes; it also
has an eight-second visible-tab fallback. The app supplies a standalone web
manifest for the synthetic mobile demo, not an offline cache of patient data.

`GET /api/patients/:patientId/care-note?clinicId=:clinicId` returns the clinic-scoped Care Note read model: current Timeline Entry versions, source-linked Highlights, and open or claimed tasks. It never falls back to another Clinic's patient record.

## Governed AI Intake

The Pilot has server-side redaction for labelled Latin/Chinese names, email-like identifiers, phone-like numbers and long ID-like numbers; strict extraction schema validation; and deterministic risk rules for allergy-medication conflicts, breathing difficulty and overdue renal follow-up. Rules create reviewable signals, not model severity or confidence.

When `DEEPSEEK_API_KEY` is present only in ignored `pilot-runtime/.env`, the server submits **already-redacted synthetic text** to DeepSeek's JSON chat API and validates the returned draft before persistence. Without that key, it uses a clearly labelled deterministic local draft instead. Browser speech recognition is an explicit synthetic-audio opt-in; it writes the reviewed transcript into the same redaction boundary and never uploads raw audio to this server. Browser recognition may use the browser vendor's service, so it is not approved for real patient data.

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

Measure the indexed Consult Glance read model against an isolated fixture of
1,000 Timeline Entries, 20 active Highlights and 10 open tasks:

```bash
npm run pilot:benchmark
```

The latest local result is P50 25.0 ms and P95 141.6 ms for 100 warm
RLS-scoped read-model requests. It excludes Auth0 network exchange and browser
rendering; see the technical brief for the exact method and scope.

## Before any Pilot data

1. Connect a managed identity provider and verify JWT issuer, audience, expiration, and subject.
2. Use a restricted database role with `BYPASSRLS` explicitly prohibited.
3. Run tenant-escape, stale-write, audit-immutability, and outbox atomicity tests against Postgres.
4. Complete the Pilot Gate in the root `CONTEXT.md`.
