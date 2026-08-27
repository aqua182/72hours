# Nightingale Pilot — 3-minute submission recording

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
| 0:20–0:45 | Clinic and role banner. | “A separately provisioned Clinic Membership controls the clinic scope. The web service uses a restricted database role and Postgres RLS.” |
| 0:45–1:15 | Ava Tan synthetic Care Note and two suggested Highlights. | “This is a synthetic longitudinal case. These are source-linked review signals, not diagnoses or model confidence scores.” |
| 1:15–1:40 | Click **View source** on Possible antibiotic reaction. | “The Evidence Workbench resolves the Highlight to an exact immutable source span, its Evidence State, and the extraction configuration.” |
| 1:40–2:05 | Click **Accept** on that Highlight. | “Only the clinician role can confirm a Highlight. Acceptance changes the linked Evidence Claim to clinician-confirmed and is audit-recorded.” |
| 2:05–2:30 | Claim the review task, then **Confirm & close** it. | “A deterministic review signal creates a task. The task is claimed before a clinician closes it with a structured resolution.” |
| 2:30–2:50 | Add a short Timeline Entry. | “A new clinical entry is created with an immutable version. Later edits append versions rather than rewrite history.” |
| 2:50–3:00 | Return to source evidence / overview. | “The Pilot preserves source, role, Clinic scope, and review history while the EHR remains the system of record.” |

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
