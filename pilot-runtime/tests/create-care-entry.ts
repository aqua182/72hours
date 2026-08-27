import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { appendCareEntryVersion, createCareEntry } from "../src/db/care-entry-repository";
import { withPilotActor } from "../src/db/actor-transaction";

function localEnvironment() {
  const values: Record<string, string> = {};
  for (const line of readFileSync("pilot-runtime/.env", "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function databaseUrl(connectionString: string, databaseName: string) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const environment = localEnvironment();
const primaryAdminUrl = environment.PILOT_ADMIN_DATABASE_URL;
const primaryWebUrl = environment.PILOT_DATABASE_URL;
if (!primaryAdminUrl || !primaryWebUrl) throw new Error("Run the local Pilot Postgres setup first.");

type Fixture = {
  clinicId: string;
  otherClinicId: string;
  userId: string;
  otherUserId: string;
  patientId: string;
  otherPatientId: string;
  subject: string;
};

async function applyMigrations(client: PoolClient, databaseName: string) {
  for (const migration of ["0000_security_roles.sql", "0001_foundation.sql", "0002_care_entry_creation.sql"]) {
    await client.query(readFileSync(`pilot-runtime/db/migrations/${migration}`, "utf8"));
  }
  await client.query(`GRANT CONNECT ON DATABASE ${databaseName} TO nightingale_web`);
}

async function createFixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID();
  const record = {
    clinicId: randomUUID(),
    otherClinicId: randomUUID(),
    userId: randomUUID(),
    otherUserId: randomUUID(),
    patientId: randomUUID(),
    otherPatientId: randomUUID(),
    subject: `pilot-entry-clinician-${suffix}`,
  };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO clinics (id, name) VALUES ($1, $2), ($3, $4)", [record.clinicId, `Entry test clinic ${suffix}`, record.otherClinicId, `Entry test other clinic ${suffix}`]);
    await client.query("INSERT INTO users (id, external_subject, display_name) VALUES ($1, $2, 'Entry test clinician'), ($3, $4, 'Other test clinician')", [record.userId, record.subject, record.otherUserId, `pilot-entry-other-${suffix}`]);
    await client.query("INSERT INTO clinic_memberships (clinic_id, user_id, role) VALUES ($1, $2, 'clinician'), ($3, $4, 'clinician')", [record.clinicId, record.userId, record.otherClinicId, record.otherUserId]);
    await client.query("INSERT INTO patients (id, clinic_id, external_reference, display_label) VALUES ($1, $2, $3, 'Synthetic entry patient'), ($4, $5, $6, 'Synthetic other patient')", [record.patientId, record.clinicId, `entry-patient-${suffix}`, record.otherPatientId, record.otherClinicId, `entry-other-patient-${suffix}`]);
    await client.query("COMMIT");
    return record;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const databaseName = `nightingale_workflow_test_${randomUUID().replaceAll("-", "")}`;
  const primaryAdmin = new Pool({ connectionString: primaryAdminUrl, max: 1 });
  let testAdmin: Pool | undefined;
  let testWeb: Pool | undefined;
  let databaseCreated = false;

  try {
    await primaryAdmin.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    testAdmin = new Pool({ connectionString: databaseUrl(primaryAdminUrl, databaseName), max: 1 });
    testWeb = new Pool({ connectionString: databaseUrl(primaryWebUrl, databaseName), max: 1 });
    const migrationClient = await testAdmin.connect();
    try {
      await applyMigrations(migrationClient, databaseName);
    } finally {
      migrationClient.release();
    }

    const setupClient = await testAdmin.connect();
    let fixture: Fixture;
    try {
      fixture = await createFixture(setupClient);
    } finally {
      setupClient.release();
    }

    const identity = { subject: fixture.subject, issuer: "test", audience: "test" };
    const created = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => createCareEntry(client, actor, { patientId: fixture.patientId, type: "clinician_note", content: "Synthetic clinician entry" }));

    const entryId = created.entryId;
    const versionId = created.entryVersionId;
    const stored = await testAdmin.query<{ current_version: number; content: string }>("SELECT e.current_version, v.content FROM care_entries e JOIN entry_versions v ON v.id = $2 WHERE e.id = $1", [entryId, versionId]);
    assert.deepEqual(stored.rows, [{ current_version: 1, content: "Synthetic clinician entry" }]);

    const appended = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => appendCareEntryVersion(client, actor, entryId, 1, "Synthetic revised clinician entry"));
    const revised = await testAdmin.query<{ current_version: number; content: string }>("SELECT e.current_version, v.content FROM care_entries e JOIN entry_versions v ON v.id = $2 WHERE e.id = $1", [entryId, appended.entryVersionId]);
    assert.deepEqual(revised.rows, [{ current_version: 2, content: "Synthetic revised clinician entry" }]);

    const audit = await testAdmin.query("SELECT action, metadata ? 'content' AS contains_content FROM audit_events WHERE target_id = $1 ORDER BY created_at", [entryId]);
    assert.deepEqual(audit.rows, [{ action: "care_entry_created", contains_content: false }, { action: "entry_version_appended", contains_content: false }]);
    const outbox = await testAdmin.query("SELECT aggregate_id FROM outbox_events WHERE aggregate_id = $1", [entryId]);
    assert.equal(outbox.rowCount, 2, "care entry creation and revision must each enqueue a collaboration event");

    await assert.rejects(
      () => withPilotActor(testWeb!, identity, fixture.clinicId, (client, actor) => appendCareEntryVersion(client, actor, entryId, 1, "Stale revision")),
      (error: unknown) => error instanceof Error && error.message.includes("version conflict"),
    );

    await assert.rejects(
      () => withPilotActor(testWeb!, identity, fixture.clinicId, (client, actor) => createCareEntry(client, actor, { patientId: fixture.otherPatientId, type: "clinician_note", content: "Cross-clinic entry" })),
      (error: unknown) => error instanceof Error && error.message.includes("patient not found"),
    );

    console.log("PASS: authenticated clinician creates and revises immutable versions with audit/outbox records; stale and cross-clinic writes are denied.");
  } finally {
    await testWeb?.end();
    await testAdmin?.end();
    if (databaseCreated) {
      await primaryAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [databaseName]);
      await primaryAdmin.query(`DROP DATABASE ${databaseName}`);
    }
    await primaryAdmin.end();
  }
}

void main();
