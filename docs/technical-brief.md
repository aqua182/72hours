# Nightingale Care Note — Pilot technical brief

## Decision: a shared record, not an opaque AI layer

Nightingale is a clinic-scoped collaboration layer beside the EHR. Its job is
to make the changing story, responsibility, and source of each signal visible
in one consult-ready view. The EHR remains the system of record. The key design
choice is that a Highlight is not a diagnosis, a risk score, or model
confidence: it is a reviewable reading-order signal backed by an immutable
source span and a stated deterministic reason.

```mermaid
flowchart LR
  I["Staff / clinician / patient interaction"] --> R["PHI redaction boundary"]
  R --> S["Governed AI source record"]
  S --> E["System-authored immutable Timeline Entry"]
  M["Manual Timeline Entry"] --> E
  E --> V["Immutable Entry Versions"]
  V --> C["Evidence Claim + exact span"]
  C --> H["Deterministic Highlight"]
  H --> G["Consult Glance + Review Task"]
  G -->|"View source"| V
  U["Clinician review / pin"] --> L["Bounded clinic learning signal"]
  L --> G
```

## Runtime and security boundary

The Pilot is a Next.js 16 application backed by PostgreSQL. Auth0 verifies the
browser identity. The service validates the issuer, audience, signature and
expiry of the access token before opening a transaction. PostgreSQL maps the
verified subject to a separately provisioned user and uses `SET LOCAL` plus
Clinic Membership Row-Level Security (RLS) for every request. Authentication
never itself creates clinic access.

The browser uses only the restricted `nightingale_web` role. Direct table
mutation is revoked; security-definer procedures implement append-version,
comment, review, task, revert, AI-intake and patient-summary actions. Every
write appends an audit event without clinical content and an outbox event in
the same transaction. An optimistic version check produces deterministic
conflict handling: an outdated edit receives `409 VERSION_CONFLICT`, and a
revert appends a new version instead of overwriting history.

```mermaid
erDiagram
  CLINIC ||--o{ CLINIC_MEMBERSHIP : scopes
  PATIENT ||--o{ CARE_ENTRY : has
  CARE_ENTRY ||--o{ ENTRY_VERSION : appends
  CARE_ENTRY ||--o{ ENTRY_COMMENT : annotates
  ENTRY_VERSION ||--o{ EVIDENCE_CLAIM : grounds
  EVIDENCE_CLAIM ||--o{ HIGHLIGHT : surfaces
  HIGHLIGHT ||--o{ CARE_TASK : triggers
  PATIENT ||--o{ AI_SCRIBED_SOURCE : retains_redacted_origin
  AI_SCRIBED_SOURCE ||--o{ CARE_ENTRY : cites
  PATIENT ||--o{ PATIENT_SUMMARY : publishes
  CLINIC ||--o{ IMPORTANCE_LEARNING : bounds_feedback
```

Roles are enforced server-side. Staff can make staff entries and collaborate,
but cannot write clinician content; clinicians can make clinician entries,
review Highlights and publish patient-facing summaries; admins have
clinic-scoped oversight. A separately provisioned patient account receives
only `patient_summaries` and may submit a patient-authored Insight. It cannot
receive the internal timeline, comments, tasks, claims, Highlights or raw AI drafts.

## Trust, AI intake and prioritisation

Three explicitly typed system entries are supported: doctor–patient consult,
nurse–patient consult and AI–patient session summaries. Before intake, common
direct identifiers—including labelled Latin/Chinese names, email-shaped
identifiers, phone-like numbers and long ID-like numbers—are redacted. The
server stores the redacted source and links the system entry to
`ai-source:<id>`; it does not present a fabricated confidence value. When a
local DeepSeek key is configured, it requests a JSON-only summary from the
configured model, validates it, and creates a Claim plus source-linked review
Highlight in the same workflow. Browser speech recognition requires explicit
synthetic-audio consent; its reviewed transcript goes through the same
redaction boundary. Neither route is authorized for real patient data.

Claims identify an immutable `entry_version` and `[start,end)` span. Clicking
**View source in Timeline** scrolls to that Entry, swaps in the immutable
historic source version, and highlights the exact span; the Evidence Workbench
also shows the excerpt, evidence state, extractor version and rule version.

Risk floors are deterministic rules over validated claims. Importance only
changes ordering. Clinician accept or pin can increment a clinic-local,
entity-type feedback value by one, capped at ten, and the read model orders by
that bounded boost; it never changes a risk rule,
clinical content, record visibility or patient summary. Reject and dismiss do
not inflate it. That gives the “learning” feature a measurable, bounded effect
rather than a drifting model ordinal.

## Assumptions and scope decisions

The Pilot assumes a single clinical organisation, a managed identity provider,
and synthetic or approved de-identified input only. It deliberately keeps the
EHR as the system of record and does not claim diagnostic authority, autonomous
triage, or patient-data production readiness. The trade-off is intentional:
source-linked review and immutable changes add interaction steps, but make it
possible to inspect why a signal is shown and who acted on it. Learning is
bounded to clinic-local reading order rather than retraining a clinical model;
this sacrifices personalisation breadth in exchange for predictable, auditable
behaviour.

## Performance, scope and verification

The Consult Glance read model is indexed by clinic, patient, status and
importance. On this local Postgres instance, `npm run pilot:benchmark` creates
an isolated synthetic fixture with 1,000 Timeline Entries, 20 active
Highlights and 10 open tasks, warms the RLS-scoped read path, then executes
100 requests. Latest result: **P50 25.0 ms, P95 141.6 ms**, below the 300 ms
target. This is a repository/read-model measurement; it deliberately excludes
the Auth0 network exchange and browser rendering, which would be measured in a
production deployment.

Automated checks cover OIDC request verification, tenant isolation and blocked
direct mutation, role-specific entry writes, version increments, stale-write
conflicts, immutable reverts, comments and resolve state, exact Highlight
provenance, clinician-only review, patient-summary isolation, deterministic
risk rules and the benchmark. Run:

```bash
npm run test:pilot-auth
npm run test:pilot-memberships
npm run test:pilot-isolation
npm run test:pilot-workflow
npm run test:pilot-rules
npm run pilot:benchmark
```

This is a synthetic-data Pilot, not a production clinical system. Local Docker
Postgres is not claimed as encrypted-at-rest production storage. Production
readiness still requires managed TLS, managed encryption at rest, formal key
management, an approved PHI processor, operational monitoring, a redaction
corpus and a clinical safety review.

Older Timeline Entries additionally receive a client-side monthly capsule
index after 90 days. The index is only a compact navigation layer: no source,
version or audit history is deleted, and every original Entry remains available.
