import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { appendCareEntryVersion, createCareEntry } from "../src/db/care-entry-repository";
import { withAuthenticatedPilotActor, withPilotActor } from "../src/db/actor-transaction";
import { listClinicMemberships } from "../src/db/membership-repository";
import { listClinicPatients } from "../src/db/patient-directory-repository";
import { claimReviewTask, closeReviewTask } from "../src/db/review-task-repository";
import { getEvidenceWorkbench, reviewHighlight } from "../src/db/evidence-workbench-repository";
import { getCareNote } from "../src/db/care-note-read-repository";
import { createAiScribedEntry, createComment, createPatientInsight, listEntryComments, listEntryVersions, listMyPatientSummaries, markEvidenceClaimConflicted, publishPatientSummary, revertEntryVersion, setCommentResolution } from "../src/db/collaboration-repository";

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
  staffUserId: string;
  patientId: string;
  otherPatientId: string;
  taskId: string;
  subject: string;
  staffSubject: string;
};

async function applyMigrations(client: PoolClient, databaseName: string) {
  for (const migration of ["0000_security_roles.sql", "0001_foundation.sql", "0002_care_entry_creation.sql", "0003_review_task_workflow.sql", "0004_evidence_review_workflow.sql", "0005_system_author_role.sql", "0006_collaboration_and_patient_portal.sql", "0007_care_note_event_feed.sql", "0008_completion_workflows.sql"]) {
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
    staffUserId: randomUUID(),
    patientId: randomUUID(),
    otherPatientId: randomUUID(),
    taskId: randomUUID(),
    subject: `pilot-entry-clinician-${suffix}`,
    staffSubject: `pilot-entry-staff-${suffix}`,
  };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO clinics (id, name) VALUES ($1, $2), ($3, $4)", [record.clinicId, `Entry test clinic ${suffix}`, record.otherClinicId, `Entry test other clinic ${suffix}`]);
    await client.query("INSERT INTO users (id, external_subject, display_name) VALUES ($1, $2, 'Entry test clinician'), ($3, $4, 'Other test clinician'), ($5, $6, 'Entry test staff')", [record.userId, record.subject, record.otherUserId, `pilot-entry-other-${suffix}`, record.staffUserId, record.staffSubject]);
    await client.query("INSERT INTO clinic_memberships (clinic_id, user_id, role) VALUES ($1, $2, 'clinician'), ($3, $4, 'clinician'), ($1, $5, 'staff')", [record.clinicId, record.userId, record.otherClinicId, record.otherUserId, record.staffUserId]);
    await client.query("INSERT INTO patients (id, clinic_id, external_reference, display_label) VALUES ($1, $2, $3, 'Synthetic entry patient'), ($4, $5, $6, 'Synthetic other patient')", [record.patientId, record.clinicId, `entry-patient-${suffix}`, record.otherPatientId, record.otherClinicId, `entry-other-patient-${suffix}`]);
    await client.query("INSERT INTO care_tasks (id, clinic_id, patient_id, source_id, title, status, review_required) VALUES ($1, $2, $3, $4, 'Synthetic review task', 'open', true)", [record.taskId, record.clinicId, record.patientId, randomUUID()]);
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
    const memberships = await withAuthenticatedPilotActor(testWeb, identity, listClinicMemberships);
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].clinicId, fixture.clinicId);
    assert.equal(memberships[0].role, "clinician");
    assert.match(memberships[0].clinicName, /^Entry test clinic /);
    const patientDirectory = await withPilotActor(testWeb, identity, fixture.clinicId, listClinicPatients);
    assert.deepEqual(patientDirectory, [{ id: fixture.patientId, displayLabel: "Synthetic entry patient" }]);
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

    const staffIdentity = { subject: fixture.staffSubject, issuer: "test", audience: "test" };
    await withPilotActor(testWeb, staffIdentity, fixture.clinicId, (client, actor) => claimReviewTask(client, actor, fixture.taskId));
    const claimedTask = await testAdmin.query("SELECT status, assignee_id FROM care_tasks WHERE id = $1", [fixture.taskId]);
    assert.deepEqual(claimedTask.rows, [{ status: "claimed", assignee_id: fixture.staffUserId }]);

    await assert.rejects(
      () => withPilotActor(testWeb!, staffIdentity, fixture.clinicId, (client, actor) => closeReviewTask(client, actor, fixture.taskId, "clinician_confirmed")),
      (error: unknown) => error instanceof Error && error.message.includes("only a clinician"),
    );

    await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => closeReviewTask(client, actor, fixture.taskId, "clinician_confirmed"));
    const closedTask = await testAdmin.query("SELECT status, closure_reason FROM care_tasks WHERE id = $1", [fixture.taskId]);
    assert.deepEqual(closedTask.rows, [{ status: "closed", closure_reason: "clinician_confirmed" }]);
    const taskAudit = await testAdmin.query("SELECT action FROM audit_events WHERE target_id = $1 ORDER BY created_at", [fixture.taskId]);
    assert.deepEqual(taskAudit.rows, [{ action: "review_task_claimed" }, { action: "review_task_closed" }]);
    const taskOutbox = await testAdmin.query("SELECT id FROM outbox_events WHERE aggregate_id = $1", [fixture.taskId]);
    assert.equal(taskOutbox.rowCount, 2, "task claim and closure must each enqueue a collaboration event");

    const claimId = randomUUID();
    const highlightId = randomUUID();
    await testAdmin.query("INSERT INTO evidence_claims (id, clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version) VALUES ($1, $2, $3, 0, 9, 'symptom', 'synthetic symptom', 'source-linked', 'test-config-v1')", [claimId, fixture.clinicId, versionId]);
    await testAdmin.query("INSERT INTO highlights (id, clinic_id, claim_id, title, risk_reason, importance, status, rule_version) VALUES ($1, $2, $3, 'Synthetic highlight', 'Synthetic review reason', 70, 'suggested', 'rule-v1')", [highlightId, fixture.clinicId, claimId]);

    const workbench = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => getEvidenceWorkbench(client, actor, highlightId));
    assert.equal(workbench.sourceExcerpt, "Synthetic", "Workbench must resolve the exact original source span");
    assert.equal(workbench.evidenceState, "source-linked");

    await assert.rejects(
      () => withPilotActor(testWeb!, staffIdentity, fixture.clinicId, (client, actor) => reviewHighlight(client, actor, highlightId, "accepted")),
      (error: unknown) => error instanceof Error && error.message.includes("only a clinician"),
    );

    await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => reviewHighlight(client, actor, highlightId, "accepted"));
    const reviewedHighlight = await testAdmin.query("SELECT h.status, c.evidence_state FROM highlights h JOIN evidence_claims c ON c.id = h.claim_id WHERE h.id = $1", [highlightId]);
    assert.deepEqual(reviewedHighlight.rows, [{ status: "accepted", evidence_state: "clinician-confirmed" }]);
    const highlightAudit = await testAdmin.query("SELECT action, metadata ? 'content' AS contains_content FROM audit_events WHERE target_id = $1", [highlightId]);
    assert.deepEqual(highlightAudit.rows, [{ action: "highlight_reviewed", contains_content: false }]);
    const highlightOutbox = await testAdmin.query("SELECT id FROM outbox_events WHERE aggregate_id = $1", [highlightId]);
    assert.equal(highlightOutbox.rowCount, 1, "highlight review must enqueue a collaboration event");

    const dismissedClaimId = randomUUID();
    const dismissedHighlightId = randomUUID();
    await testAdmin.query("INSERT INTO evidence_claims (id, clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version) VALUES ($1, $2, $3, 0, 9, 'symptom', 'dismissed synthetic symptom', 'source-linked', 'test-config-v1')", [dismissedClaimId, fixture.clinicId, versionId]);
    await testAdmin.query("INSERT INTO highlights (id, clinic_id, claim_id, title, risk_reason, importance, status, rule_version) VALUES ($1, $2, $3, 'Dismissable synthetic highlight', 'Synthetic review reason', 60, 'suggested', 'rule-v1')", [dismissedHighlightId, fixture.clinicId, dismissedClaimId]);
    await assert.rejects(
      () => withPilotActor(testWeb!, identity, fixture.clinicId, (client, actor) => reviewHighlight(client, actor, dismissedHighlightId, "dismissed")),
      (error: unknown) => error instanceof Error && error.message.includes("dismissal reason required"),
    );
    await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => reviewHighlight(client, actor, dismissedHighlightId, "dismissed", "source_outdated"));
    const dismissed = await testAdmin.query("SELECT h.status, h.dismissal_reason, c.evidence_state FROM highlights h JOIN evidence_claims c ON c.id = h.claim_id WHERE h.id = $1", [dismissedHighlightId]);
    assert.deepEqual(dismissed.rows, [{ status: "dismissed", dismissal_reason: "source_outdated", evidence_state: "source-linked" }]);

    await testAdmin.query("INSERT INTO care_tasks (id, clinic_id, patient_id, source_id, title, status, review_required) VALUES ($1, $2, $3, $4, 'Synthetic open follow-up', 'open', false)", [randomUUID(), fixture.clinicId, fixture.patientId, randomUUID()]);
    const careNote = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => getCareNote(client, actor, fixture.patientId));
    assert.equal(careNote.patient.displayLabel, "Synthetic entry patient");
    assert.deepEqual(careNote.entries.map((entry) => entry.content), ["Synthetic revised clinician entry"]);
    assert.deepEqual(careNote.highlights.map((highlight) => highlight.status).sort(), ["accepted", "dismissed"]);
    assert.deepEqual(careNote.openTasks.map((task) => task.title), ["Synthetic open follow-up"]);
    await assert.rejects(
      () => withPilotActor(testWeb!, identity, fixture.clinicId, (client, actor) => getCareNote(client, actor, fixture.otherPatientId)),
      (error: unknown) => error instanceof Error && error.message.includes("patient not found"),
    );

    const comment = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => createComment(client, actor, entryId, "Please confirm the plan before the next consult."));
    const comments = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => listEntryComments(client, actor, entryId));
    assert.deepEqual(comments.map((item) => item.body), ["Please confirm the plan before the next consult."]);
    await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => setCommentResolution(client, actor, comment.comment_id, true));
    const resolvedComments = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => listEntryComments(client, actor, entryId));
    assert.equal(resolvedComments[0].status, "resolved", "comment resolution must be persisted in the audit-backed workflow");

    const reverted = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => revertEntryVersion(client, actor, entryId, 1, 2));
    assert.ok(reverted.version_id);
    const history = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => listEntryVersions(client, actor, entryId));
    assert.deepEqual(history.map((item) => [item.version, item.content]), [[3, "Synthetic clinician entry"], [2, "Synthetic revised clinician entry"], [1, "Synthetic clinician entry"]]);
    const revertAudit = await testAdmin.query("SELECT action FROM audit_events WHERE target_id = $1 AND action = 'entry_reverted'", [entryId]);
    assert.equal(revertAudit.rowCount, 1, "revert must append an audit event rather than mutate history");

    const aiEntry = await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => createAiScribedEntry(client, actor, fixture.patientId, "ai_patient_session_summary", "Synthetic patient discussion, contact [REDACTED].", "Patient asks when to arrange renal blood test."));
    const aiStored = await testAdmin.query("SELECT author_role, type, provenance_pointer FROM care_entries WHERE id = $1", [aiEntry.care_entry_id]);
    assert.deepEqual(aiStored.rows, [{ author_role: "system", type: "ai_patient_session_summary", provenance_pointer: aiEntry.provenance_pointer }]);
    const aiHighlight = await testAdmin.query("SELECT h.risk_reason FROM highlights h JOIN evidence_claims c ON c.id = h.claim_id WHERE c.entry_version_id = $1", [aiEntry.entry_version_id]);
    assert.equal(aiHighlight.rowCount, 1, "every AI-scribed entry must create a source-linked review Highlight");

    const patientSubject = `pilot-entry-patient-${randomUUID()}`;
    const patientUserId = randomUUID();
    await testAdmin.query("INSERT INTO users (id, external_subject, display_name) VALUES ($1, $2, 'Synthetic portal patient')", [patientUserId, patientSubject]);
    await testAdmin.query("INSERT INTO patient_portal_access (patient_id, user_id) VALUES ($1, $2)", [fixture.patientId, patientUserId]);
    await withPilotActor(testWeb, identity, fixture.clinicId, (client, actor) => publishPatientSummary(client, actor, fixture.patientId, "Your care plan", "Please arrange the renal blood test and contact the clinic if symptoms worsen."));
    const portalSummaries = await withAuthenticatedPilotActor(testWeb, { subject: patientSubject, issuer: "test", audience: "test" }, listMyPatientSummaries);
    assert.deepEqual(portalSummaries.map((item) => item.content), ["Please arrange the renal blood test and contact the clinic if symptoms worsen."], "patient portal must expose only explicitly published summaries");
    const insight = await withAuthenticatedPilotActor(testWeb, { subject: patientSubject, issuer: "test", audience: "test" }, (client) => createPatientInsight(client, fixture.patientId, "I am worried the rash is spreading."));
    const insightRow = await testAdmin.query("SELECT author_role, type FROM care_entries WHERE id = $1", [insight.entry_id]);
    assert.deepEqual(insightRow.rows, [{ author_role: "patient", type: "patient_insight" }]);
    await withPilotActor(testWeb, identity, fixture.clinicId, (client) => markEvidenceClaimConflicted(client, claimId));
    const conflicted = await testAdmin.query("SELECT evidence_state FROM evidence_claims WHERE id = $1", [claimId]);
    assert.deepEqual(conflicted.rows, [{ evidence_state: "conflicted" }]);
    const summaryOutbox = await testAdmin.query("SELECT id FROM outbox_events WHERE aggregate_type = 'patient_summary'");
    assert.equal(summaryOutbox.rowCount, 1, "patient summary publication must enqueue an outbox event");
    const eventTimestamp = await withPilotActor(testWeb, identity, fixture.clinicId, async (client) => {
      return client.query<{ changed_at: string | null }>("SELECT care_note_changed_after($1, '1970-01-01T00:00:00Z'::timestamptz)::text AS changed_at", [fixture.patientId]);
    });
    assert.ok(eventTimestamp.rows[0].changed_at, "web role receives only a change timestamp, not direct outbox access");

    console.log("PASS: authenticated Care Note workflows preserve current versions, provenance, clinic isolation, audit, and outbox events.");
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
