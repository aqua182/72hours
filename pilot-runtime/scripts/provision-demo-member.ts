import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

type Role = "staff" | "clinician" | "admin";

const demoPatientReference = "NIGHTINGALE-DEMO-AVA-001";

function localEnvironment() {
  const values: Record<string, string> = {};
  for (const line of readFileSync(resolve(process.cwd(), "pilot-runtime/.env"), "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function requireArgument(label: string, value: string | undefined) {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function roleArgument(value: string | undefined): Role {
  if (value === "staff" || value === "clinician" || value === "admin") return value;
  throw new Error("role must be staff, clinician, or admin");
}

async function insertEntry(client: PoolClient, input: { clinicId: string; patientId: string; authorId: string; authorRole: Role; type: string; content: string }) {
  const entry = await client.query<{ id: string }>(
    `INSERT INTO care_entries (clinic_id, patient_id, author_id, author_role, type, visibility)
     VALUES ($1, $2, $3, $4, $5::entry_type, 'internal') RETURNING id`,
    [input.clinicId, input.patientId, input.authorId, input.authorRole, input.type],
  );
  const version = await client.query<{ id: string }>(
    `INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by)
     VALUES ($1, $2, 1, $3, $4) RETURNING id`,
    [input.clinicId, entry.rows[0].id, input.content, input.authorId],
  );
  return { entryId: entry.rows[0].id, versionId: version.rows[0].id };
}

async function seedDemoCareNote(client: PoolClient, input: { clinicId: string }) {
  const existing = await client.query<{ id: string }>("SELECT id FROM patients WHERE clinic_id = $1 AND external_reference = $2", [input.clinicId, demoPatientReference]);
  if (existing.rowCount === 1) return { patientId: existing.rows[0].id, created: false };

  const demoAuthor = await client.query<{ id: string }>(
    `INSERT INTO users (id, external_subject, display_name)
     VALUES (gen_random_uuid(), $1, 'Nightingale Synthetic Clinician')
     ON CONFLICT (external_subject) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`synthetic-demo-clinician:${input.clinicId}`],
  );
  await client.query(
    `INSERT INTO clinic_memberships (clinic_id, user_id, role, active)
     VALUES ($1, $2, 'clinician', true)
     ON CONFLICT (clinic_id, user_id) DO UPDATE SET role = 'clinician', active = true`,
    [input.clinicId, demoAuthor.rows[0].id],
  );
  const patient = await client.query<{ id: string }>(
    "INSERT INTO patients (clinic_id, external_reference, display_label) VALUES ($1, $2, 'Ava Tan (Synthetic)') RETURNING id",
    [input.clinicId, demoPatientReference],
  );
  const patientId = patient.rows[0].id;
  const authorRole: Role = "clinician";
  const rashContent = "Patient reports a spreading rash after starting amoxicillin. No breathing difficulty reported.";
  const renalContent = "Renal blood test remains outstanding. Follow-up is required before the next consult.";

  const authorId = demoAuthor.rows[0].id;
  const rash = await insertEntry(client, { clinicId: input.clinicId, patientId, authorId, authorRole, type: "staff_note", content: rashContent });
  await insertEntry(client, {
    clinicId: input.clinicId,
    patientId,
    authorId,
    authorRole,
    type: "clinician_note",
    content: "Stop amoxicillin pending review. Document suspected penicillin allergy. Arrange same-day clinician review.",
  });
  const renal = await insertEntry(client, { clinicId: input.clinicId, patientId, authorId, authorRole, type: "ai_nurse_consult_summary", content: renalContent });

  const rashStart = rashContent.indexOf("spreading rash");
  const renalStart = renalContent.indexOf("Renal blood test");
  const rashClaim = await client.query<{ id: string }>(
    `INSERT INTO evidence_claims (clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version)
     VALUES ($1, $2, $3, $4, 'symptom', 'spreading rash', 'source-linked', 'demo-extraction-v1') RETURNING id`,
    [input.clinicId, rash.versionId, rashStart, rashStart + "spreading rash".length],
  );
  const renalClaim = await client.query<{ id: string }>(
    `INSERT INTO evidence_claims (clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version)
     VALUES ($1, $2, $3, $4, 'follow_up', 'renal blood test outstanding', 'source-linked', 'demo-extraction-v1') RETURNING id`,
    [input.clinicId, renal.versionId, renalStart, renalStart + "Renal blood test".length],
  );
  const reaction = await client.query<{ id: string }>(
    `INSERT INTO highlights (clinic_id, claim_id, title, risk_reason, importance, status, rule_version)
     VALUES ($1, $2, 'Possible antibiotic reaction', 'Medication-symptom review required', 95, 'suggested', 'demo-rule-v1') RETURNING id`,
    [input.clinicId, rashClaim.rows[0].id],
  );
  const renalHighlight = await client.query<{ id: string }>(
    `INSERT INTO highlights (clinic_id, claim_id, title, risk_reason, importance, status, rule_version)
     VALUES ($1, $2, 'Renal blood test remains open', 'Overdue follow-up requires coordination', 72, 'suggested', 'demo-rule-v1') RETURNING id`,
    [input.clinicId, renalClaim.rows[0].id],
  );
  await client.query(
    `INSERT INTO care_tasks (clinic_id, patient_id, source_id, title, status, review_required, due_at)
     VALUES ($1, $2, $3, 'Review possible amoxicillin reaction — not a diagnosis', 'open', true, now() + interval '1 day'),
            ($1, $2, $4, 'Book renal blood test', 'open', false, now() + interval '2 days')`,
    [input.clinicId, patientId, reaction.rows[0].id, renalHighlight.rows[0].id],
  );
  return { patientId, created: true };
}

async function main() {
  const [subjectInput, displayNameInput, clinicNameInput, roleInput] = process.argv.slice(2);
  const subject = requireArgument("Auth0 subject", subjectInput);
  const displayName = requireArgument("Display name", displayNameInput);
  const clinicName = requireArgument("Clinic name", clinicNameInput);
  const role = roleArgument(roleInput);
  const environment = localEnvironment();
  if (!environment.PILOT_ADMIN_DATABASE_URL) throw new Error("PILOT_ADMIN_DATABASE_URL is required; run the local Postgres setup first.");

  const pool = new Pool({ connectionString: environment.PILOT_ADMIN_DATABASE_URL, max: 1, application_name: "nightingale-pilot-provisioner" });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existingClinic = await client.query<{ id: string }>("SELECT id FROM clinics WHERE name = $1 ORDER BY created_at ASC LIMIT 1", [clinicName]);
      const clinicId = existingClinic.rowCount === 1
        ? existingClinic.rows[0].id
        : (await client.query<{ id: string }>("INSERT INTO clinics (name) VALUES ($1) RETURNING id", [clinicName])).rows[0].id;
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (id, external_subject, display_name)
         VALUES (gen_random_uuid(), $1, $2)
         ON CONFLICT (external_subject) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [subject, displayName],
      );
      const userId = user.rows[0].id;
      await client.query(
        `INSERT INTO clinic_memberships (clinic_id, user_id, role, active)
         VALUES ($1, $2, $3::user_role, true)
         ON CONFLICT (clinic_id, user_id) DO UPDATE SET role = EXCLUDED.role, active = true`,
        [clinicId, userId, role],
      );
      const demo = await seedDemoCareNote(client, { clinicId });
      await client.query("COMMIT");
      process.stdout.write(`READY: ${demo.created ? "created" : "reused"} synthetic Care Note for clinic ${clinicId}; patient ${demo.patientId}.\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Provisioning failed");
  process.exit(1);
});
