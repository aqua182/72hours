# Nightingale Pilot

Nightingale is a synthetic-data, clinic-scoped care-collaboration Pilot. It
keeps the EHR as the system of record while making source evidence, ownership,
review decisions and immutable history visible in one consult-ready view.

## Quick start

Requirements: Node.js 22+, Docker Desktop, and a local Auth0 development
tenant. This repository never includes database passwords, Auth0 secrets, or
real patient data.

```bash
npm install
bash pilot-runtime/scripts/setup-postgres.sh
bash pilot-runtime/scripts/setup-auth0.sh
npm run pilot:dev
```

Open `http://localhost:3001`, complete Auth0 sign-in, then provision synthetic
demonstration users with the administrator-only commands in
[pilot-runtime/README.md](pilot-runtime/README.md). The complete setup,
Auth0, provisioning, database, and benchmark instructions are in that Pilot
README.

## Run automated tests

The required named micro-tests run against isolated temporary PostgreSQL
databases using the restricted `nightingale_web` role. They do not use the old
Demo role switcher.

```bash
npm run test:micro
npm run test:pilot-auth
npm run test:pilot-memberships
npm run test:pilot-isolation
npm run test:pilot-workflow
npm run test:pilot-rules
npm run pilot:benchmark
```

Run one required micro-test with:

```bash
npm run test:pilot-micro -- rbac
# Other cases: revision, provenance, concurrency, importance
```

The required test entry points are:

- `tests/test_rbac_scope.py`
- `tests/test_revision_history.py`
- `tests/test_highlight_provenance.py`
- `tests/test_concurrent_edits.py`
- `tests/test_self_learning_importance.py` (bonus)

## Redaction and AI boundary

Before an AI draft is stored or sent to a configured provider, the server
redacts labelled Latin and Chinese names, email-like identifiers, phone-like
numbers, and long ID-like numbers in
[`pilot-runtime/src/ai/redaction.ts`](pilot-runtime/src/ai/redaction.ts).
The original clinical text remains in its immutable Entry Version; the AI
workflow stores the redacted source separately and connects the resulting
system entry to an `ai-source:<id>` provenance pointer.

DeepSeek is optional and receives only already-redacted synthetic input. If it
is not configured, the Pilot uses a clearly labelled deterministic local draft.
Browser speech recognition requires explicit synthetic-audio consent and raw
audio is never sent to this server.

## RBAC and data isolation

Auth0 verifies identity before each request. The application maps the verified
subject to a provisioned user, opens a transaction, sets the identity only with
`SET LOCAL`, and lets PostgreSQL Row-Level Security enforce Clinic Membership.
The browser uses the restricted `nightingale_web` database role; it cannot
bypass RLS or write tables directly.

| Role | Permitted capability |
|---|---|
| Patient | Read published summaries and submit/view only their own insight receipts |
| Staff | Create and edit Staff Notes, comment, and claim coordination tasks |
| Clinician | Create and edit Clinician Notes, review Highlights, publish summaries |
| Admin | Clinic-scoped oversight and permitted governance actions |

Staff cannot create or edit Clinician Notes, and Clinicians cannot create or
edit Staff Notes. Patient RLS scope excludes internal Timeline entries,
comments, tasks, Claims, Highlights, and raw AI sources.

## Submission materials

- [Pilot setup and operational runbook](pilot-runtime/README.md)
- [2-3 page technical brief (PDF)](output/pdf/nightingale-pilot-technical-brief.pdf) and [editable source](docs/technical-brief.md)
- [Attribution](ATTRIBUTION.txt)
- [Demo recording runbook](pilot-runtime/docs/DEMO-RUNBOOK.md)

All content and accounts used in the demonstration are synthetic. This is a
Pilot foundation, not a production clinical system.
