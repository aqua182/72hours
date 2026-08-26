# Nightingale Care Note

Nightingale Care Note is a clinic-scoped longitudinal collaboration layer that complements an EHR. It helps care teams identify, verify, and act on the most relevant patient context without replacing clinical judgment.

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

**Patient Insight**:
A patient-submitted Timeline Entry, visible to the clinic team and governed separately from patient-facing summaries. A patient may submit an insight but cannot access internal material.
_Avoid_: patient note, patient message

**Demo Session**:
A server-signed authenticated session for one of four seeded roles: patient, staff, clinician, or admin. Changing demo identity creates a new session rather than changing a client-side role value.
_Avoid_: role switcher, mock identity

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
