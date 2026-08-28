import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

const demoPatientReference = "NIGHTINGALE-DEMO-AVA-001";

function localEnvironment() {
  const values: Record<string, string> = {};
  for (const line of readFileSync(resolve(process.cwd(), "pilot-runtime/.env"), "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function required(label: string, value: string | undefined) {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

async function main() {
  const [subjectInput, displayNameInput, clinicNameInput] = process.argv.slice(2);
  const subject = required("Auth0 User ID", subjectInput);
  const displayName = required("Display name", displayNameInput);
  const clinicName = required("Clinic name", clinicNameInput);
  const environment = localEnvironment();
  if (!environment.PILOT_ADMIN_DATABASE_URL) throw new Error("PILOT_ADMIN_DATABASE_URL is required; run the local Postgres setup first.");

  const pool = new Pool({ connectionString: environment.PILOT_ADMIN_DATABASE_URL, max: 1, application_name: "nightingale-pilot-patient-provisioner" });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const patient = await client.query<{ id: string }>(
        `SELECT p.id
         FROM patients p JOIN clinics c ON c.id = p.clinic_id
         WHERE c.name = $1 AND p.external_reference = $2`,
        [clinicName, demoPatientReference],
      );
      if (patient.rowCount !== 1) throw new Error("Synthetic Ava Tan record not found. First provision a clinician for this clinic.");
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (id, external_subject, display_name)
         VALUES (gen_random_uuid(), $1, $2)
         ON CONFLICT (external_subject) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [subject, displayName],
      );
      await client.query(
        `INSERT INTO patient_portal_access (patient_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (patient_id, user_id) DO NOTHING`,
        [patient.rows[0].id, user.rows[0].id],
      );
      await client.query("COMMIT");
      process.stdout.write("READY: patient-facing access granted for Ava Tan (Synthetic).\\n");
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
  console.error(error instanceof Error ? error.message : "Patient provisioning failed");
  process.exit(1);
});
