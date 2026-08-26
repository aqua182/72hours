# Nightingale Care Note

A trust-first, clinic-scoped longitudinal collaboration layer for EHR context. The demo uses **synthetic data only** and is designed to answer, in under ten seconds: what changed, what needs action, and where did that information come from?

## Run it

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install pytest
npm run dev
```

Open `http://localhost:3000`. Use the Demo identity control to establish a real server-side session for Clinician, Staff, Patient, or Admin.

```bash
npm run test:micro
npm run build
```

## What to demo

1. As **Clinician**, see source-linked risks, recent changes, and open actions in the Glance View.
2. Click **View source** on “Possible antibiotic reaction” to jump to the exact AI-patient session entry.
3. Accept a Highlight: its Evidence Claim becomes `clinician-confirmed`; the action is audited.
4. Claim the unassigned review task as Staff.
5. Switch to Patient: raw AI notes, internal Highlights, tasks, and collaboration records are absent from the API response—not merely hidden in the UI.

## Trust model

- AI summaries are system-authored Timeline Entries; they are never presented as clinician documentation.
- AI extraction produces source-linked, initially unverified Evidence Claims. A Highlight cannot exist without an immutable Entry Version and source span.
- Risk Flags are deterministic rule outputs, not model-assigned risk scores. A source-linked but unverified claim may create a **review required—not a diagnosis** task.
- `importance` is a reading-order signal. It is not a diagnosis, risk score, or self-reported model confidence.
- A clinician accepts a Highlight to mark its Claim clinician-confirmed. Rejecting or dismissing a Highlight never edits the underlying source.

## RBAC

Authorization is enforced in route handlers before data is read or mutated. Session identity is stored in an HTTP-only cookie; switching demo identity creates a new session.

| Role | Allowed |
|---|---|
| Patient | Patient-facing instructions and creation of future patient insights; no internal notes, comments, tasks, or raw AI summaries |
| Staff | Clinic-scoped Timeline; own Staff Notes; comments and task claiming |
| Clinician | Clinic-scoped Timeline, Clinical Plan, AI summaries, Highlight acceptance |
| Admin | Clinic-scoped oversight and task operations |

Staff cannot edit clinician entries; clinicians cannot edit staff entries. Entry edits use optimistic concurrency and reject stale same-section writes with `409 VERSION_CONFLICT`.

## Redaction and privacy

`src/server/redaction.ts` redacts names, IC/ID-like values, and phone numbers before text is passed to the LLM adapter. A server-only provenance mapping relates a redacted prompt back to its original Entry Version and span. Synthetic source content and generated output are related in the database; note content is not written to audit logs.

The repository is a local demonstration, not a production deployment. Production must use TLS, managed encryption at rest, key management, real authentication, and Postgres RLS. The local SQLite file is intentionally excluded from source control and is **not represented as encrypted storage**.

## Tests

The required Python test files are black-box HTTP tests. They start the Next.js app, establish signed demo sessions, and test actual route behavior:

- `tests/test_rbac_scope.py`
- `tests/test_revision_history.py`
- `tests/test_highlight_provenance.py`
- `tests/test_concurrent_edits.py`

## Warm-path performance method

The Glance endpoint reads active Highlights and open tasks by patient rather than recomputing the longitudinal record on every visit. The target is P95 ≤ 300ms after initial app/data load. For a submission measurement, seed 1,000 historical low-importance entries plus 20 active Highlights and 10 open tasks, issue 100 authenticated requests to `GET /api/patients/patient-ava`, and record the P95. The prototype surfaces the query strategy in the UI but does not claim a benchmark result until it is measured on the submission machine.

## Key design decisions

The project glossary is in [`CONTEXT.md`](./CONTEXT.md). Architectural decisions are in [`docs/adr`](./docs/adr), including immutable provenance, redaction, non-clinical importance learning, self-contained RBAC, optional LLM fallback, and data decay by collapse rather than deletion.
