import type { PoolClient } from "pg";
import type { PilotActor } from "./actor-transaction";

export type CareNote = {
  patient: { id: string; displayLabel: string; externalReference: string };
  entries: Array<{ id: string; type: string; authorRole: string; currentVersion: number; content: string; changedAt: string; provenancePointer: string | null }>;
  highlights: Array<{ id: string; title: string; status: string; importance: number; baseImportance: number; learningBoost: number; riskReason: string; evidenceState: string; entityType: string; sourceEntryId: string; sourceEntryVersionId: string; spanStart: number; spanEnd: number }>;
  openTasks: Array<{ id: string; title: string; status: string; reviewRequired: boolean; dueAt: string | null }>;
};

export async function getCareNote(client: PoolClient, actor: PilotActor, patientId: string): Promise<CareNote> {
  const patientResult = await client.query<{ id: string; display_label: string; external_reference: string }>(
    "SELECT id, display_label, external_reference FROM patients WHERE id = $1 AND clinic_id = $2",
    [patientId, actor.clinicId],
  );
  if (patientResult.rowCount !== 1) throw new Error("patient not found");

  const entries = await client.query<{ id: string; type: string; author_role: string; current_version: number; content: string; changed_at: string; provenance_pointer: string | null }>(
    `SELECT e.id, e.type, e.author_role, e.current_version, e.provenance_pointer, v.content, v.changed_at::text
     FROM care_entries e
     JOIN entry_versions v ON v.entry_id = e.id AND v.version = e.current_version
     WHERE e.patient_id = $1 AND e.clinic_id = $2
     ORDER BY v.changed_at ASC, e.id ASC`,
    [patientId, actor.clinicId],
  );
  const highlights = await client.query<{ id: string; title: string; status: string; importance: number; base_importance: number; learning_boost: number; risk_reason: string; evidence_state: string; entity_type: string; source_entry_id: string; source_entry_version_id: string; span_start: number; span_end: number }>(
    `SELECT h.id, h.title, h.status, LEAST(100, h.importance + COALESCE(l.score, 0)) AS importance, h.importance AS base_importance,
            COALESCE(l.score, 0) AS learning_boost, h.risk_reason, c.evidence_state, c.entity_type, v.entry_id AS source_entry_id,
            v.id AS source_entry_version_id, c.span_start, c.span_end
     FROM highlights h
     JOIN evidence_claims c ON c.id = h.claim_id
     JOIN entry_versions v ON v.id = c.entry_version_id
     JOIN care_entries e ON e.id = v.entry_id
     LEFT JOIN importance_learning l ON l.clinic_id = h.clinic_id AND l.entity_type = c.entity_type
     WHERE e.patient_id = $1 AND h.clinic_id = $2
     ORDER BY h.importance DESC, h.created_at ASC, h.id ASC`,
    [patientId, actor.clinicId],
  );
  const openTasks = await client.query<{ id: string; title: string; status: string; review_required: boolean; due_at: string | null }>(
    `SELECT id, title, status, review_required, due_at::text
     FROM care_tasks
     WHERE patient_id = $1 AND clinic_id = $2 AND status IN ('open', 'claimed')
     ORDER BY due_at ASC NULLS LAST, created_at ASC, id ASC`,
    [patientId, actor.clinicId],
  );

  return {
    patient: { id: patientResult.rows[0].id, displayLabel: patientResult.rows[0].display_label, externalReference: patientResult.rows[0].external_reference },
    entries: entries.rows.map((entry) => ({ id: entry.id, type: entry.type, authorRole: entry.author_role, currentVersion: entry.current_version, content: entry.content, changedAt: entry.changed_at, provenancePointer: entry.provenance_pointer })),
    highlights: highlights.rows.map((highlight) => ({ id: highlight.id, title: highlight.title, status: highlight.status, importance: highlight.importance, baseImportance: highlight.base_importance, learningBoost: highlight.learning_boost, riskReason: highlight.risk_reason, evidenceState: highlight.evidence_state, entityType: highlight.entity_type, sourceEntryId: highlight.source_entry_id, sourceEntryVersionId: highlight.source_entry_version_id, spanStart: highlight.span_start, spanEnd: highlight.span_end })),
    openTasks: openTasks.rows.map((task) => ({ id: task.id, title: task.title, status: task.status, reviewRequired: task.review_required, dueAt: task.due_at })),
  };
}
