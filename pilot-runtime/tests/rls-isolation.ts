import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";

type Fixture = {
  aliceClinicId: string;
  bobClinicId: string;
  aliceUserId: string;
  bobUserId: string;
  aliceEntryId: string;
  bobEntryId: string;
  aliceSubject: string;
  bobSubject: string;
};

function readLocalEnvironment() {
  const values: Record<string, string> = {};
  for (const line of readFileSync("pilot-runtime/.env", "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0 || line.startsWith("#")) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

const localEnvironment = readLocalEnvironment();
const adminDatabaseUrl = localEnvironment.PILOT_ADMIN_DATABASE_URL;
const webDatabaseUrl = localEnvironment.PILOT_DATABASE_URL;

if (!adminDatabaseUrl || !webDatabaseUrl) {
  throw new Error("Run bash pilot-runtime/scripts/setup-postgres.sh before this test.");
}

async function createFixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID();
  const fixture = {
    aliceClinicId: randomUUID(),
    bobClinicId: randomUUID(),
    aliceUserId: randomUUID(),
    bobUserId: randomUUID(),
    aliceEntryId: randomUUID(),
    bobEntryId: randomUUID(),
    aliceSubject: `pilot-isolation-alice-${suffix}`,
    bobSubject: `pilot-isolation-bob-${suffix}`,
  };

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO clinics (id, name) VALUES ($1, $2), ($3, $4)", [fixture.aliceClinicId, `Isolation clinic A ${suffix}`, fixture.bobClinicId, `Isolation clinic B ${suffix}`]);
    await client.query("INSERT INTO users (id, external_subject, display_name) VALUES ($1, $2, 'Alice test clinician'), ($3, $4, 'Bob test clinician')", [fixture.aliceUserId, fixture.aliceSubject, fixture.bobUserId, fixture.bobSubject]);
    await client.query("INSERT INTO clinic_memberships (clinic_id, user_id, role) VALUES ($1, $2, 'clinician'), ($3, $4, 'clinician')", [fixture.aliceClinicId, fixture.aliceUserId, fixture.bobClinicId, fixture.bobUserId]);

    const alicePatientId = randomUUID();
    const bobPatientId = randomUUID();
    await client.query("INSERT INTO patients (id, clinic_id, external_reference, display_label) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)", [alicePatientId, fixture.aliceClinicId, `isolation-a-${suffix}`, "Synthetic patient A", bobPatientId, fixture.bobClinicId, `isolation-b-${suffix}`, "Synthetic patient B"]);
    await client.query("INSERT INTO care_entries (id, clinic_id, patient_id, author_id, author_role, type) VALUES ($1, $2, $3, $4, 'clinician', 'clinician_note'), ($5, $6, $7, $8, 'clinician', 'clinician_note')", [fixture.aliceEntryId, fixture.aliceClinicId, alicePatientId, fixture.aliceUserId, fixture.bobEntryId, fixture.bobClinicId, bobPatientId, fixture.bobUserId]);
    await client.query("INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by) VALUES ($1, $2, 1, 'Synthetic entry A', $3), ($4, $5, 1, 'Synthetic entry B', $6)", [fixture.aliceClinicId, fixture.aliceEntryId, fixture.aliceUserId, fixture.bobClinicId, fixture.bobEntryId, fixture.bobUserId]);
    await client.query("COMMIT");
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function cleanFixture(client: PoolClient, fixture: Fixture) {
  await client.query("BEGIN");
  try {
    const clinicIds = [fixture.aliceClinicId, fixture.bobClinicId];
    await client.query("DELETE FROM outbox_events WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM audit_events WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM evidence_claims WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM highlights WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM care_tasks WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM entry_versions WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM care_entries WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM patients WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM clinic_memberships WHERE clinic_id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM clinics WHERE id = ANY($1::uuid[])", [clinicIds]);
    await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[fixture.aliceUserId, fixture.bobUserId]]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function cleanStaleIsolationFixtures(client: PoolClient) {
  await client.query("BEGIN");
  try {
    const fixtureClinics = "SELECT id FROM clinics WHERE name LIKE 'Isolation clinic %'";
    await client.query(`DELETE FROM outbox_events WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM audit_events WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM evidence_claims WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM highlights WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM care_tasks WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM entry_versions WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM care_entries WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM patients WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM clinic_memberships WHERE clinic_id IN (${fixtureClinics})`);
    await client.query(`DELETE FROM clinics WHERE name LIKE 'Isolation clinic %'`);
    await client.query("DELETE FROM users WHERE external_subject LIKE 'pilot-isolation-%'");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function asVerifiedActor<T>(pool: Pool, subject: string, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT establish_authenticated_actor($1)", [subject]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function expectRejected(action: () => Promise<unknown>, expectedMessage: string) {
  await assert.rejects(action, (error: unknown) => error instanceof Error && error.message.includes(expectedMessage));
}

async function main() {
  const administrator = new Pool({ connectionString: adminDatabaseUrl, max: 1 });
  const webRole = new Pool({ connectionString: webDatabaseUrl, max: 2 });
  const setupClient = await administrator.connect();
  let fixture: Fixture;
  try {
    await cleanStaleIsolationFixtures(setupClient);
    fixture = await createFixture(setupClient);
  } finally {
    setupClient.release();
  }

  try {
    const alicePatients = await asVerifiedActor(webRole, fixture.aliceSubject, async (client) => {
      return client.query<{ external_reference: string }>("SELECT external_reference FROM patients ORDER BY external_reference");
    });
    assert.deepEqual(alicePatients.rows.map((row) => row.external_reference), [`isolation-a-${fixture.aliceSubject.slice("pilot-isolation-alice-".length)}`], "Alice must read only Clinic A's patient");

    await expectRejected(
      () => asVerifiedActor(webRole, fixture.aliceSubject, (client) => client.query("SELECT append_entry_version($1, 1, 'cross-clinic write')", [fixture.bobEntryId])),
      "entry not found",
    );

    await expectRejected(
      () => asVerifiedActor(webRole, fixture.aliceSubject, (client) => client.query("UPDATE entry_versions SET content = 'tampered' WHERE entry_id = $1", [fixture.aliceEntryId])),
      "permission denied",
    );

    const bobPatients = await asVerifiedActor(webRole, fixture.bobSubject, async (client) => {
      return client.query<{ external_reference: string }>("SELECT external_reference FROM patients ORDER BY external_reference");
    });
    assert.deepEqual(bobPatients.rows.map((row) => row.external_reference), [`isolation-b-${fixture.bobSubject.slice("pilot-isolation-bob-".length)}`], "Bob must read only Clinic B's patient");

    console.log("PASS: Web-role RLS blocks cross-clinic reads and writes; direct version mutation is denied.");
  } finally {
    const cleanupClient = await administrator.connect();
    try {
      await cleanFixture(cleanupClient, fixture);
    } finally {
      cleanupClient.release();
      await webRole.end();
      await administrator.end();
    }
  }
}

void main();
