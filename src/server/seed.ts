import { randomUUID } from "node:crypto";
import { initDb, row, run } from "./db";

initDb();

if (!row<{ id: string }>("SELECT id FROM patients LIMIT 1")) {
  const clinic = "clinic-nightingale";
  const patient = "patient-ava";
  const userRows = [
    ["u-patient", clinic, "Ava Tan", "patient"],
    ["u-staff", clinic, "Maya Lim", "staff"],
    ["u-clinician", clinic, "Dr. Daniel Koh", "clinician"],
    ["u-admin", clinic, "Priya Shah", "admin"],
    ["system", clinic, "System", "system"],
  ];
  for (const user of userRows) run("INSERT INTO users VALUES (?, ?, ?, ?)", user);
  run("INSERT INTO patients VALUES (?, ?, ?, ?)", [patient, clinic, "Ava Tan (Synthetic)", "1983-09-14"]);

  const addEntry = (id: string, authorId: string, role: string, type: string, visibility: string, createdAt: string, content: string, provenance: string | null = null) => {
    const versionId = `${id}-v1`;
    run("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, patient, authorId, role, type, visibility, createdAt, 1, provenance]);
    run("INSERT INTO entry_versions VALUES (?, ?, ?, ?, ?, ?)", [versionId, id, 1, content, authorId, createdAt]);
    return versionId;
  };

  addEntry("e-old", "u-clinician", "clinician", "clinician_note", "internal", "2025-04-15T09:30:00Z", "Stable asthma. Continue salbutamol as needed. No known drug allergies recorded.");
  const patientText = "I started amoxicillin last week. After the second dose I developed an itchy red rash on my arms. I am worried because the rash is spreading.";
  const patientVersion = addEntry("e-patient-ai", "system", "system", "ai_patient_session_summary", "internal", "2026-02-06T08:45:00Z", patientText, "session://ai-patient-2026-02-06");
  const nurseText = "Nurse call summary: patient reports rash after amoxicillin and has not completed the requested renal blood test. No breathing difficulty reported.";
  const nurseVersion = addEntry("e-nurse-ai", "system", "system", "ai_nurse_consult_summary", "internal", "2026-02-06T10:10:00Z", nurseText, "session://ai-nurse-2026-02-06");
  addEntry("e-staff", "u-staff", "staff", "staff_note", "internal", "2026-02-06T10:22:00Z", "Lab order remains unbooked. @Dr. Daniel Koh: please review possible antibiotic reaction.");
  addEntry("e-plan", "u-clinician", "clinician", "clinician_note", "internal", "2026-02-06T11:04:00Z", "Clinical Plan: stop amoxicillin pending review. Document suspected penicillin allergy. Arrange same-day clinician review.");
  addEntry("e-patient-summary", "u-clinician", "clinician", "instruction", "patient", "2026-02-06T11:08:00Z", "Please stop the medicine discussed today and contact the clinic promptly if the rash worsens or you develop breathing difficulty.");

  const addClaim = (id: string, entryId: string, versionId: string, text: string, needle: string, entity: string, value: string, state = "unverified") => {
    const start = text.indexOf(needle);
    run("INSERT INTO evidence_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, entryId, versionId, start, start + needle.length, entity, value, state]);
  };
  addClaim("c-rash", "e-patient-ai", patientVersion, patientText, "itchy red rash", "symptom", "rash", "unverified");
  addClaim("c-amoxicillin", "e-patient-ai", patientVersion, patientText, "amoxicillin", "medication", "amoxicillin", "unverified");
  addClaim("c-breathing", "e-nurse-ai", nurseVersion, nurseText, "No breathing difficulty", "red_flag", "absent", "unverified");

  run("INSERT INTO highlights VALUES (?, ?, ?, ?, ?, ?)", ["h-allergy", "c-amoxicillin", "Possible antibiotic reaction", "Medication mention + rash in source-linked AI session; clinician review required.", 96, "suggested"]);
  run("INSERT INTO highlights VALUES (?, ?, ?, ?, ?, ?)", ["h-rash", "c-rash", "New spreading rash", "Recent symptom change from patient AI session.", 88, "suggested"]);
  run("INSERT INTO highlights VALUES (?, ?, ?, ?, ?, ?)", ["h-lab", "c-breathing", "Renal blood test remains open", "Unresolved follow-up noted by nurse AI summary.", 72, "suggested"]);
  run("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["t-review", patient, "h-allergy", "Review possible amoxicillin reaction — not a diagnosis", "open", null, "2026-02-06T15:00:00Z", 1]);
  run("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["t-lab", patient, "e-staff", "Book renal blood test", "open", "u-staff", "2026-02-07T09:00:00Z", 0]);
  run("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), "system", "seeded", patient, JSON.stringify({ synthetic: true }), new Date().toISOString()]);
}

run("INSERT OR IGNORE INTO highlights VALUES (?, ?, ?, ?, ?, ?)", ["h-rash-context", "c-rash", "Patient concern about spreading rash", "Same symptom topic; ranked through clinic feedback.", 54, "suggested"]);
