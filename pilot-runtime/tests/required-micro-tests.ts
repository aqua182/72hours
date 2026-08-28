import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { withAuthenticatedPilotActor, withPilotActor } from "../src/db/actor-transaction";
import { appendCareEntryVersion, createCareEntry } from "../src/db/care-entry-repository";
import { createAiScribedEntry, createComment, listEntryVersions, revertEntryVersion } from "../src/db/collaboration-repository";
import { getCareNote } from "../src/db/care-note-read-repository";
import { getEvidenceWorkbench, reviewHighlight } from "../src/db/evidence-workbench-repository";

type Identity = { subject: string; issuer: string; audience: string };
type Fixture = {
  clinicId: string;
  patientId: string;
  clinician: { id: string; identity: Identity };
  staff: { id: string; identity: Identity };
  patient: { id: string; identity: Identity };
};
type Context = { admin: Pool; web: Pool; fixture: Fixture };

function localEnvironment() {
  const values: Record<string, string> = {};
  for (const line of readFileSync("pilot-runtime/.env", "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function databaseUrl(connectionString: string, databaseName: string) {
  const url = new URL(connectionString); url.pathname = `/${databaseName}`; return url.toString();
}

const migrations = ["0000_security_roles.sql", "0001_foundation.sql", "0002_care_entry_creation.sql", "0003_review_task_workflow.sql", "0004_evidence_review_workflow.sql", "0005_system_author_role.sql", "0006_collaboration_and_patient_portal.sql", "0007_care_note_event_feed.sql", "0008_completion_workflows.sql", "0009_patient-insight-receipts.sql"];

async function applyMigrations(client: PoolClient, databaseName: string) {
  for (const migration of migrations) await client.query(readFileSync(`pilot-runtime/db/migrations/${migration}`, "utf8"));
  await client.query(`GRANT CONNECT ON DATABASE ${databaseName} TO nightingale_web`);
}

async function createFixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID();
  const fixture: Fixture = {
    clinicId: randomUUID(), patientId: randomUUID(),
    clinician: { id: randomUUID(), identity: { subject: `micro-clinician-${suffix}`, issuer: "test", audience: "test" } },
    staff: { id: randomUUID(), identity: { subject: `micro-staff-${suffix}`, issuer: "test", audience: "test" } },
    patient: { id: randomUUID(), identity: { subject: `micro-patient-${suffix}`, issuer: "test", audience: "test" } },
  };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO clinics (id, name) VALUES ($1, $2)", [fixture.clinicId, `Required micro-test clinic ${suffix}`]);
    await client.query("INSERT INTO users (id, external_subject, display_name) VALUES ($1, $2, 'Micro clinician'), ($3, $4, 'Micro staff'), ($5, $6, 'Micro patient')", [fixture.clinician.id, fixture.clinician.identity.subject, fixture.staff.id, fixture.staff.identity.subject, fixture.patient.id, fixture.patient.identity.subject]);
    await client.query("INSERT INTO clinic_memberships (clinic_id, user_id, role) VALUES ($1, $2, 'clinician'), ($1, $3, 'staff')", [fixture.clinicId, fixture.clinician.id, fixture.staff.id]);
    await client.query("INSERT INTO patients (id, clinic_id, external_reference, display_label) VALUES ($1, $2, $3, 'Micro-test patient')", [fixture.patientId, fixture.clinicId, `micro-patient-${suffix}`]);
    await client.query("INSERT INTO patient_portal_access (patient_id, user_id) VALUES ($1, $2)", [fixture.patientId, fixture.patient.id]);
    await client.query("COMMIT"); return fixture;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function withContext(test: (context: Context) => Promise<void>) {
  const environment = localEnvironment();
  if (!environment.PILOT_ADMIN_DATABASE_URL || !environment.PILOT_DATABASE_URL) throw new Error("Run the local Pilot Postgres setup first.");
  const databaseName = `nightingale_micro_test_${randomUUID().replaceAll("-", "")}`;
  const primaryAdmin = new Pool({ connectionString: environment.PILOT_ADMIN_DATABASE_URL, max: 1 });
  let admin: Pool | undefined;
  let web: Pool | undefined;
  try {
    await primaryAdmin.query(`CREATE DATABASE ${databaseName}`);
    admin = new Pool({ connectionString: databaseUrl(environment.PILOT_ADMIN_DATABASE_URL, databaseName), max: 4 });
    web = new Pool({ connectionString: databaseUrl(environment.PILOT_DATABASE_URL, databaseName), max: 10 });
    const migrationClient = await admin.connect();
    try { await applyMigrations(migrationClient, databaseName); } finally { migrationClient.release(); }
    const fixtureClient = await admin.connect();
    let fixture: Fixture;
    try { fixture = await createFixture(fixtureClient); } finally { fixtureClient.release(); }
    await test({ admin, web, fixture });
  } finally {
    await web?.end(); await admin?.end();
    await primaryAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [databaseName]);
    await primaryAdmin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await primaryAdmin.end();
  }
}

async function asClinicRole<T>(context: Context, role: "clinician" | "staff", work: Parameters<typeof withPilotActor<T>>[3]) {
  return withPilotActor(context.web, context.fixture[role].identity, context.fixture.clinicId, work);
}

async function expectRejected(work: () => Promise<unknown>, expectedMessage: string) {
  await assert.rejects(work, (error: unknown) => error instanceof Error && error.message.includes(expectedMessage));
}

async function testRbacScope() {
  await withContext(async (context) => {
    const clinicianEntry = await asClinicRole(context, "clinician", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "clinician_note", content: "Clinician-only note" }));
    const staffEntry = await asClinicRole(context, "staff", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "staff_note", content: "Staff-only note" }));
    await expectRejected(() => asClinicRole(context, "staff", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "clinician_note", content: "Blocked impersonation" })), "staff may create staff notes only");
    await expectRejected(() => asClinicRole(context, "clinician", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "staff_note", content: "Blocked impersonation" })), "clinician may create clinician notes only");
    await expectRejected(() => asClinicRole(context, "staff", (client, actor) => appendCareEntryVersion(client, actor, clinicianEntry.entryId, 1, "Blocked staff edit")), "role cannot edit this entry");
    await expectRejected(() => asClinicRole(context, "clinician", (client, actor) => appendCareEntryVersion(client, actor, staffEntry.entryId, 1, "Blocked clinician edit")), "role cannot edit this entry");

    const aiEntry = await asClinicRole(context, "clinician", (client, actor) => createAiScribedEntry(client, actor, context.fixture.patientId, "ai_patient_session_summary", "Synthetic redacted interaction", "Synthetic AI draft"));
    await asClinicRole(context, "clinician", (client, actor) => createComment(client, actor, clinicianEntry.entryId, "Internal clinical discussion"));
    const patientRead = await withAuthenticatedPilotActor(context.web, context.fixture.patient.identity, async (client) => {
      const entries = await client.query("SELECT id FROM care_entries WHERE id = $1 OR id = $2", [clinicianEntry.entryId, aiEntry.care_entry_id]);
      const comments = await client.query("SELECT id FROM entry_comments");
      const sources = await client.query("SELECT id FROM ai_scribed_sources");
      return { entries: entries.rowCount, comments: comments.rowCount, sources: sources.rowCount };
    });
    assert.deepEqual(patientRead, { entries: 0, comments: 0, sources: 0 }, "patient RLS scope must exclude internal notes, comments, and raw AI sources");
  });
}

async function testRevisionHistory() {
  await withContext(async (context) => {
    const created = await asClinicRole(context, "clinician", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "clinician_note", content: "Version one" }));
    await asClinicRole(context, "clinician", (client, actor) => appendCareEntryVersion(client, actor, created.entryId, 1, "Version two"));
    const beforeRevert = await asClinicRole(context, "clinician", (client, actor) => listEntryVersions(client, actor, created.entryId));
    assert.deepEqual(beforeRevert.map((version) => [version.version, version.content]), [[2, "Version two"], [1, "Version one"]], "editing must append version two");
    await asClinicRole(context, "clinician", (client, actor) => revertEntryVersion(client, actor, created.entryId, 1, 2));
    const history = await asClinicRole(context, "clinician", (client, actor) => listEntryVersions(client, actor, created.entryId));
    assert.deepEqual(history.map((version) => [version.version, version.content]), [[3, "Version one"], [2, "Version two"], [1, "Version one"]], "revert must restore prior content as a new version");
    const audit = await context.admin.query<{ actor_id: string; action: string; metadata: unknown }>("SELECT actor_id::text, action, metadata FROM audit_events WHERE target_id = $1 ORDER BY created_at", [created.entryId]);
    assert.ok(audit.rows.some((event) => event.action === "entry_reverted" && event.actor_id === context.fixture.clinician.id), "audit must identify the actor and change action");
    assert.ok(audit.rows.every((event) => !JSON.stringify(event.metadata).includes("Version one") && !JSON.stringify(event.metadata).includes("Version two")), "audit metadata must not contain note content");
  });
}

async function testHighlightProvenance() {
  await withContext(async (context) => {
    const ai = await asClinicRole(context, "clinician", (client, actor) => createAiScribedEntry(client, actor, context.fixture.patientId, "ai_doctor_consult_summary", "Synthetic redacted doctor interaction", "Synthetic AI-scribed doctor summary"));
    const highlight = await context.admin.query<{ id: string }>("SELECT id FROM highlights WHERE claim_id IN (SELECT id FROM evidence_claims WHERE entry_version_id = $1)", [ai.entry_version_id]);
    assert.equal(highlight.rowCount, 1, "AI-scribed entry must generate one review Highlight");
    const workbench = await asClinicRole(context, "clinician", (client, actor) => getEvidenceWorkbench(client, actor, highlight.rows[0].id));
    assert.equal(workbench.sourceEntryId, ai.care_entry_id);
    assert.equal(workbench.sourceEntryVersionId, ai.entry_version_id);
    assert.ok(workbench.spanStart >= 0 && workbench.spanEnd > workbench.spanStart && workbench.spanEnd <= workbench.sourceVersionContent.length, "Highlight provenance must resolve to an exact immutable entry span");
    assert.equal(workbench.sourceExcerpt, workbench.sourceVersionContent.slice(workbench.spanStart, workbench.spanEnd));
  });
}

async function testConcurrentEdits() {
  await withContext(async (context) => {
    const staffEntry = await asClinicRole(context, "staff", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "staff_note", content: "Staff section v1" }));
    const clinicianEntry = await asClinicRole(context, "clinician", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "clinician_note", content: "Clinician section v1" }));
    const differentSections = await Promise.all([
      asClinicRole(context, "staff", (client, actor) => appendCareEntryVersion(client, actor, staffEntry.entryId, 1, "Staff section v2")),
      asClinicRole(context, "clinician", (client, actor) => appendCareEntryVersion(client, actor, clinicianEntry.entryId, 1, "Clinician section v2")),
    ]);
    assert.equal(differentSections.length, 2, "different sections must save concurrently without overwriting each other");
    const sameSection = await Promise.allSettled([
      asClinicRole(context, "clinician", (client, actor) => appendCareEntryVersion(client, actor, clinicianEntry.entryId, 2, "Concurrent choice A")),
      asClinicRole(context, "clinician", (client, actor) => appendCareEntryVersion(client, actor, clinicianEntry.entryId, 2, "Concurrent choice B")),
    ]);
    assert.equal(sameSection.filter((result) => result.status === "fulfilled").length, 1, "exactly one same-section write may win");
    assert.ok(sameSection.some((result) => result.status === "rejected" && result.reason instanceof Error && result.reason.message.includes("version conflict")), "the losing same-section write must receive deterministic VERSION_CONFLICT");
  });
}

async function testSelfLearningImportance() {
  await withContext(async (context) => {
    const source = await asClinicRole(context, "clinician", (client, actor) => createCareEntry(client, actor, { patientId: context.fixture.patientId, type: "clinician_note", content: "Synthetic source for similar AI review signals" }));
    const firstClaim = randomUUID(); const firstHighlight = randomUUID();
    await context.admin.query("INSERT INTO evidence_claims (id, clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version) VALUES ($1, $2, $3, 0, 9, 'ai_scribed_draft', 'synthetic', 'source-linked', 'micro-v1')", [firstClaim, context.fixture.clinicId, source.entryVersionId]);
    await context.admin.query("INSERT INTO highlights (id, clinic_id, claim_id, title, risk_reason, importance, status, rule_version) VALUES ($1, $2, $3, 'First AI review', 'Synthetic review required', 58, 'suggested', 'micro-v1')", [firstHighlight, context.fixture.clinicId, firstClaim]);
    await asClinicRole(context, "clinician", (client, actor) => reviewHighlight(client, actor, firstHighlight, "pinned"));
    const secondClaim = randomUUID(); const secondHighlight = randomUUID();
    await context.admin.query("INSERT INTO evidence_claims (id, clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version) VALUES ($1, $2, $3, 0, 9, 'ai_scribed_draft', 'synthetic', 'source-linked', 'micro-v1')", [secondClaim, context.fixture.clinicId, source.entryVersionId]);
    await context.admin.query("INSERT INTO highlights (id, clinic_id, claim_id, title, risk_reason, importance, status, rule_version) VALUES ($1, $2, $3, 'Subsequent AI review', 'Synthetic review required', 58, 'suggested', 'micro-v1')", [secondHighlight, context.fixture.clinicId, secondClaim]);
    const careNote = await asClinicRole(context, "clinician", (client, actor) => getCareNote(client, actor, context.fixture.patientId));
    const subsequent = careNote.highlights.find((highlight) => highlight.id === secondHighlight);
    assert.deepEqual(subsequent && { baseImportance: subsequent.baseImportance, learningBoost: subsequent.learningBoost, importance: subsequent.importance }, { baseImportance: 58, learningBoost: 1, importance: 59 }, "a similar future suggestion must receive the bounded clinic-local priority boost after pinning");
  });
}

const tests: Record<string, () => Promise<void>> = { rbac: testRbacScope, revision: testRevisionHistory, provenance: testHighlightProvenance, concurrency: testConcurrentEdits, importance: testSelfLearningImportance };
async function main() {
  const selected = process.argv.slice(2);
  const requested = selected.length ? selected : Object.keys(tests);
  for (const name of requested) {
    const test = tests[name];
    if (!test) throw new Error(`Unknown micro-test: ${name}`);
    await test(); console.log(`PASS: Pilot Postgres/RBAC micro-test — ${name}`);
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
