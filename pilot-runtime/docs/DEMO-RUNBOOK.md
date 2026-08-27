# Nightingale Pilot — 4-minute submission recording

This is a synthetic-data demonstration of a Pilot workflow. It must not be
described as a production EHR, autonomous clinical decision system, or a
deployment authorized for unrestricted patient data.

## Before recording

1. Confirm Docker Desktop is running, then run `npm run pilot:dev` from the
   repository root.
2. Open `http://localhost:3001` and sign in with the approved Auth0 test user.
3. If the screen says that access is awaiting approval, run the documented
   `npm run pilot:provision -- ...` command locally. Use the Auth0 User ID only
   in the terminal; do not show or narrate it in the recording.
4. Reload the Pilot. The header should name `Nightingale Pilot Dev`, identify
   the `clinician` role, and say that the record is synthetic.

## Recording script

| Time | What to show | What to say |
| --- | --- | --- |
| 0:00–0:20 | Signed-in landing page. | “Nightingale is an EHR collaboration layer. Auth0 verifies identity, but signing in alone does not grant any patient access.” |
| 0:20–0:40 | Clinic and role banner. | “A separately provisioned Clinic Membership controls the clinic scope. The web service uses a restricted database role and Postgres RLS.” |
| 0:40–1:05 | Ava Tan synthetic Care Note and suggested Highlights. | “These are source-linked review signals, not diagnoses or model confidence scores. Importance ranks attention; it does not set clinical severity.” |
| 1:05–1:30 | Click **View source in Timeline**. | “The page scrolls to the exact immutable source span. The Workbench shows the excerpt, Evidence State, extractor version and rule version.” |
| 1:30–1:45 | Accept or pin a Highlight. | “Only a clinician can confirm it. That decision is audit-recorded and gives only future similar suggestions a capped reading-order boost.” |
| 1:45–2:20 | Open **Discuss · history · audit**, add a comment, then resolve it. | “Comments are threaded collaboration records with resolve state. They are internal and never sent to the patient view.” |
| 2:20–2:45 | Edit a clinician entry, open the Version list, then restore an older version. | “Every edit appends an immutable version. Restore creates another version rather than deleting the record of change.” |
| 2:45–3:15 | Create one synthetic AI draft from each of the three interaction types. | “The source text is redacted before persistence. These appear as distinct system-authored drafts with inspectable source pointers.” |
| 3:15–3:35 | Publish a patient-facing summary. | “Only clinician-published plain-language instructions are eligible for the separate patient view; raw AI drafts and comments are excluded.” |
| 3:35–4:00 | Claim/close a task and return to Glance. | “The Pilot preserves source, role, clinic scope and review history while the EHR remains the system of record.” |

## Do not show

- Auth0 Client Secret, session secret, database URLs or passwords.
- Raw Auth0 User IDs, browser developer tools, cookies, access tokens or logs.
- Any real patient information. This scenario is Ava Tan (Synthetic) only.

## Final recording checklist

- The sign-in page or first narration establishes verified identity.
- The Clinic/role banner is visible.
- At least one source lookup is shown before a review action.
- At least one task lifecycle action is shown.
- The screen visibly labels the scenario as synthetic.
