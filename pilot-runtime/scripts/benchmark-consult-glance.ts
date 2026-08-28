import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { getCareNote } from "../src/db/care-note-read-repository";
import { withPilotActor } from "../src/db/actor-transaction";

function localEnvironment() {
  const values: Record<string, string> = {};
  for (const line of readFileSync("pilot-runtime/.env", "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}
function percentile(sorted: number[], value: number) { return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)]; }

async function main() {
  const environment = localEnvironment();
  if (!environment.PILOT_ADMIN_DATABASE_URL || !environment.PILOT_DATABASE_URL) throw new Error("Run the local Pilot Postgres setup first.");
  const admin = new Pool({ connectionString: environment.PILOT_ADMIN_DATABASE_URL, max: 1 });
  const web = new Pool({ connectionString: environment.PILOT_DATABASE_URL, max: 10 });
  const suffix = randomUUID();
  const ids = { clinic: randomUUID(), user: randomUUID(), patient: randomUUID(), version: randomUUID() };
  const subject = `pilot-benchmark-${suffix}`;
  try {
    await admin.query("BEGIN");
    await admin.query("INSERT INTO clinics (id, name) VALUES ($1, $2)", [ids.clinic, `Benchmark clinic ${suffix}`]);
    await admin.query("INSERT INTO users (id, external_subject, display_name) VALUES ($1, $2, 'Benchmark clinician')", [ids.user, subject]);
    await admin.query("INSERT INTO clinic_memberships (clinic_id, user_id, role) VALUES ($1, $2, 'clinician')", [ids.clinic, ids.user]);
    await admin.query("INSERT INTO patients (id, clinic_id, external_reference, display_label) VALUES ($1, $2, $3, 'Benchmark synthetic patient')", [ids.patient, ids.clinic, `benchmark-${suffix}`]);
    await admin.query(
      `WITH entries AS (
        INSERT INTO care_entries (clinic_id, patient_id, author_id, author_role, type)
        SELECT $1, $2, $3, 'clinician', 'clinician_note' FROM generate_series(1, 1000) RETURNING id, clinic_id
      ) INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by)
      SELECT clinic_id, id, 1, 'Synthetic benchmark timeline entry', $3 FROM entries`,
      [ids.clinic, ids.patient, ids.user],
    );
    const source = await admin.query<{ id: string }>("SELECT id FROM entry_versions WHERE clinic_id = $1 ORDER BY id LIMIT 1", [ids.clinic]);
    for (let index = 0; index < 20; index += 1) {
      const claim = await admin.query<{ id: string }>("INSERT INTO evidence_claims (clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version) VALUES ($1, $2, 0, 9, 'follow_up', $3, 'source-linked', 'benchmark-v1') RETURNING id", [ids.clinic, source.rows[0].id, `benchmark-${index}`]);
      await admin.query("INSERT INTO highlights (clinic_id, claim_id, title, risk_reason, importance, status, rule_version) VALUES ($1, $2, $3, 'Benchmark review reason', $4, 'suggested', 'benchmark-v1')", [ids.clinic, claim.rows[0].id, `Benchmark highlight ${index}`, 100 - index]);
    }
    await admin.query("INSERT INTO care_tasks (clinic_id, patient_id, source_id, title, status, review_required) SELECT $1, $2, gen_random_uuid(), 'Benchmark open action ' || generate_series, 'open', false FROM generate_series(1, 10)", [ids.clinic, ids.patient]);
    await admin.query("COMMIT");

    const identity = { subject, issuer: "benchmark", audience: "benchmark" };
    await withPilotActor(web, identity, ids.clinic, (client, actor) => getCareNote(client, actor, ids.patient));
    const timings: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      await withPilotActor(web, identity, ids.clinic, (client, actor) => getCareNote(client, actor, ids.patient));
      timings.push(performance.now() - started);
    }
    timings.sort((left, right) => left - right);
    console.log(JSON.stringify({ method: "100 warm RLS-scoped read-model requests; excludes Auth0 network and browser render", timelineEntries: 1000, activeHighlights: 20, openTasks: 10, p50Ms: Number(percentile(timings, 0.5).toFixed(1)), p95Ms: Number(percentile(timings, 0.95).toFixed(1)), targetMs: 300 }, null, 2));
  } finally {
    await admin.query("BEGIN").catch(() => undefined);
    await admin.query("DELETE FROM outbox_events WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM audit_events WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM highlights WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM evidence_claims WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM care_tasks WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM entry_versions WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM care_entries WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM patients WHERE id = $1", [ids.patient]).catch(() => undefined);
    await admin.query("DELETE FROM clinic_memberships WHERE clinic_id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM clinics WHERE id = $1", [ids.clinic]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id = $1", [ids.user]).catch(() => undefined);
    await admin.query("COMMIT").catch(() => admin.query("ROLLBACK").catch(() => undefined));
    await web.end(); await admin.end();
  }
}
void main();
