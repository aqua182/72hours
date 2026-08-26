# Nightingale Care Note

Nightingale Care Note is a clinic-scoped longitudinal collaboration layer that complements an EHR. It helps care teams identify, verify, and act on the most relevant patient context without replacing clinical judgment.

**Pilot**:
A single-clinic, clinician-led validation of a defined care workflow using synthetic or de-identified data. A Pilot is not a production multi-clinic service and does not authorize unrestricted PHI processing.
_Avoid_: demo, production launch, proof of concept

**Pilot Runtime**:
The separately deployed, security-governed implementation used for a Pilot. It may reuse validated product behavior from the Demo but does not inherit its development authentication or local storage model.
_Avoid_: upgraded demo, production mode

**System of Record**:
The EHR that remains authoritative for formal clinical documentation, orders, and billing. Nightingale supplements it with collaboration and longitudinal context.
_Avoid_: source of truth for orders, replacement EHR

**Clinic Membership**:
The verified relationship between an authenticated user and a clinic that determines which Pilot records the user may read or mutate.
_Avoid_: selected clinic, client-side tenant

**FHIR Snapshot**:
A read-only, time-stamped import of EHR data using a standard FHIR representation. It is an external input to a Care Note and does not grant Nightingale authority to write back to the EHR.
_Avoid_: EHR mirror, editable EHR record

**Sync Status**:
The explicit freshness and failure state of an external FHIR import, including last successful synchronization time and affected scope. It prevents old external data from being implied to be current.
_Avoid_: current data, silent fallback

## Record

**Care Note**:
The complete longitudinal collaboration record for one patient within one clinic. It contains the timeline, current Clinical Plan, tasks, comments, and patient-facing material.
_Avoid_: chart, page, note

**Timeline Entry**:
An atomic, time-stamped record in a Care Note with an author role, visibility, provenance, and version history.
_Avoid_: note, event, message

**Clinical Plan**:
The clinician-owned current care decision within a Care Note. It is distinct from historical Timeline Entries and may only be edited by a clinician.
_Avoid_: treatment note, clinician note

**Patient-facing Summary**:
Published Care Note content intended for the patient. It excludes internal collaboration and raw AI-scribed material.
_Avoid_: patient note, public timeline

## Evidence and signals

**Evidence Claim**:
A minimal factual extraction linked to an exact source entry version and text span. It may support a summary, Highlight, or rule evaluation only while that source link resolves.
_Avoid_: AI fact, inferred fact, paraphrase

**AI Intake Pipeline**:
The auditable sequence that redacts a sourced interaction, validates extracted Evidence Claims against a schema, applies deterministic rules, and produces reviewable Highlights.
_Avoid_: free-form AI summary, autonomous clinical reasoning

**Evidence Workbench**:
The clinician review surface that presents a Claim's source span, extracted entities, rule and configuration version, evidence state, and recorded review decision in one place.
_Avoid_: AI card, summary viewer

**Superseded Source**:
The state of an Evidence Claim whose source Entry has a newer version. The claim remains linked to its immutable original version and remains inspectable.
_Avoid_: updated source, rewritten history

**Highlight**:
An actionable, source-linked suggestion surfaced from one or more Evidence Claims. A user can accept, reject, pin, or dismiss it.
_Avoid_: alert, insight, score

**Risk Flag**:
A source-linked warning created by a deterministic clinical or operational rule. It is not a model-assigned ordinal score and results in a review task.
_Avoid_: risk score, model risk level

**Risk Rule**:
A deterministic condition that can create a Risk Flag. The prototype rule catalogue covers allergy-medication conflicts, predefined red-flag symptoms, unresolved urgent items, and overdue high-priority follow-ups.
_Avoid_: AI risk assessment, severity model

**Importance**:
A transparent reading-order signal used to rank Highlights in the Glance View. It is neither a risk assessment nor a clinical conclusion.
_Avoid_: priority score, severity

**Review Required Risk Flag**:
A Risk Flag created from a source-linked but unverified AI Evidence Claim. It is explicitly not a diagnosis and creates an unassigned Review Task.
_Avoid_: confirmed risk, automated diagnosis

**Evidence State**:
The verification condition of a claim or Highlight: source-linked, clinician-confirmed, conflicted, or unverified.
_Avoid_: model confidence, confidence label

**Clinician Confirmation**:
The Evidence State assigned to an Evidence Claim when a clinician accepts its Highlight. Rejection or dismissal changes the Highlight only and never alters the Claim or source Entry.
_Avoid_: AI approval, edited evidence

**Redacted Prompt**:
The privacy-filtered representation of an Entry sent to an LLM. It retains an auditable link to the source Entry and generated output without sending names, ID numbers, or phone numbers.
_Avoid_: raw prompt, anonymized note

**Provenance Mapping**:
A server-only offset or token mapping from a Redacted Prompt to its source Entry Version. It allows generated claims to resolve to original source spans without exposing raw content to the LLM, browser, or logs.
_Avoid_: client-side offsets, prompt source link

**Conflict**:
The state of an older Evidence Claim that has the same structured entity and an opposing normalized value to a newer clinician-authored Clinical Plan. The older source remains available but does not take precedence in the Glance View.
_Avoid_: overwritten memory, corrected source

## Collaboration

**Review Task**:
A cancellable, auditable request for a care-team member to review a Risk Flag or follow-up item. A rule-created Review Task begins unassigned and may be claimed by an authorized team member.
_Avoid_: alert, escalation

**Triage Owner**:
The clinic-designated role responsible for claiming and escalating review-required Risk Flags within the agreed service level. The Triage Owner does not turn a signal into a diagnosis.
_Avoid_: alert recipient, automated resolver

**Care Review Loop**:
The accountable Pilot workflow from sourced intake through triage claim, staff follow-up, clinician confirmation or override, and auditable task closure.
_Avoid_: notification flow, free-form collaboration

**Patient Insight**:
A patient-submitted Timeline Entry, visible to the clinic team and governed separately from patient-facing summaries. A patient may submit an insight but cannot access internal material.
_Avoid_: patient note, patient message

**Sandbox Patient View**:
A non-production patient-facing experience used only with synthetic or de-identified data during the Pilot. It must not authenticate or collect information from real patients.
_Avoid_: patient portal, Pilot user

**Demo Session**:
A development-only role switch using a seeded user cookie. It is not an authenticated or signed session and must not be used in a Pilot.
_Avoid_: authenticated session, secure identity

**Authenticated Session**:
A managed-identity-backed session whose user, clinic membership, and role are verified server-side. It is the only session type permitted in a Pilot.
_Avoid_: demo session, client-selected role

**Collaboration Event**:
An immutable, versioned notification of a Care Note change delivered to authorized clinic members. It refreshes a viewer's current state but does not merge simultaneous edits to the same section.
_Avoid_: live co-editing, CRDT operation

**Outbox Event**:
A transactionally recorded Collaboration Event that is delivered to authorized subscribers after the Care Note change commits. It supports retry without making the browser the event source.
_Avoid_: database trigger broadcast, client polling

**Risk Dismissal Reason**:
A required structured explanation for dismissing a Risk Flag: not clinically relevant, source outdated, or rule false positive.
_Avoid_: silent dismissal, free-text-only reason

**Importance Feedback**:
An accept, reject, pin, or dismiss-with-reason interaction recorded against a Highlight. It contributes to a clinic-shared Importance ranking signal but never risk rules, clinical content, or patient-facing content.
_Avoid_: training data, clinical learning

## Longitudinal history

**Monthly Capsule**:
A collapsible monthly representation of older, low-importance Timeline Entries. It preserves links to every original Entry and is only used when no associated item is risky, open, or clinician-confirmed.
_Avoid_: archived record, deleted history

## Validation

**Micro-test**:
A required pytest black-box test that starts the Next.js app and exercises its authenticated HTTP API. It validates the application rather than a separate reimplementation of its domain logic.
_Avoid_: fixture-only test, duplicate business logic

**Warm-path Benchmark**:
A measurement of the already-loaded Glance View API across at least 100 requests against one patient with 1,000 Timeline Entries, 20 active Highlights, and 10 open tasks. Its target is P95 at or below 300ms.
_Avoid_: empty-state benchmark, first-load timing

**Pilot Gate**:
The mandatory release checklist for a Pilot: real authentication, tenant-isolation attack tests, atomic version writes, audit export, redaction regression tests, and a reviewed threat model.
_Avoid_: launch checklist, optional hardening

**Stage Gate**:
The non-skippable acceptance criteria between Foundation, Workflow, Intelligence, and Pilot Operations. A later stage cannot compensate for an earlier stage that has not met its safety criteria.
_Avoid_: roadmap milestone, feature list

**Accountable Owner**:
A named person with authority for one Pilot responsibility: clinical behavior, privacy/security, or product/operations. Accountability may not be assigned to an unspecified team.
_Avoid_: stakeholder, team owner

**Failure-Safe Mode**:
The explicit state entered when an external dependency fails. It displays data freshness and scope, preserves read-only history, and prevents new AI output or silent use of stale external data.
_Avoid_: graceful degradation, fallback mode

**Import Revocation**:
The recorded withdrawal of an imported data set's processing authorization. It stops future processing and applies the configured deletion policy to removable copies while retaining the minimum necessary audit evidence.
_Avoid_: hard delete, erased audit

**Retention Policy**:
A clinic-configured and auditable rule for retaining, expiring, or deleting a data class. Care Note content, immutable audit records, and operational data may have different policies.
_Avoid_: hard-coded retention period, one-size-fits-all deletion

**Governed Clinical Configuration**:
A versioned, reviewable, and reversible configuration for risk rules, redaction rules, or extraction prompts. Each change requires clinician-owner and product-owner approval plus regression validation.
_Avoid_: prompt edit, hidden rule change

**Quality Review**:
The clinic-lead review of AI decisions, risk-task SLA, configuration versions, clinician overrides, and provenance outcomes. It is an operational feedback process, not model self-evaluation.
_Avoid_: analytics dashboard, confidence report

**Environment**:
An isolated deployment stage with a defined data class and access policy: development uses synthetic data, staging uses de-identified regression samples, and Pilot uses controlled Pilot data.
_Avoid_: deployment branch, shared database

**Pilot Success Metric**:
A pre-defined operational or trust measure used to decide whether to expand the Pilot, such as consult-preparation time, task SLA, clinician-confirmed Highlight precision, reject reasons, or source-resolution rate.
_Avoid_: page views, model calls
