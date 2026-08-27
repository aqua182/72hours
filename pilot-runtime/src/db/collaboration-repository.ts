import type { PoolClient } from "pg";
import type { PilotActor } from "./actor-transaction";

export type Comment = { id: string; parentCommentId: string | null; body: string; authorRole: string; status: "open" | "resolved"; mentionedName: string | null; assigneeName: string | null; createdAt: string };
export type EntryVersion = { id: string; version: number; content: string; changedAt: string; changedByRole: string };

export async function listEntryComments(client: PoolClient, actor: PilotActor, entryId: string): Promise<Comment[]> {
  const result = await client.query<{ id: string; parent_comment_id: string | null; body: string; author_role: string; status: "open" | "resolved"; mentioned_name: string | null; assignee_name: string | null; created_at: string }>(
    `SELECT c.id, c.parent_comment_id, c.body, c.author_role, c.status, mentioned.display_name AS mentioned_name,
            assignee.display_name AS assignee_name, c.created_at::text
     FROM entry_comments c
     JOIN care_entries e ON e.id = c.entry_id
     LEFT JOIN users mentioned ON mentioned.id = c.mentioned_user_id
     LEFT JOIN users assignee ON assignee.id = c.assigned_to_user_id
     WHERE c.entry_id = $1 AND c.clinic_id = $2 AND e.clinic_id = $2 ORDER BY c.created_at ASC, c.id ASC`, [entryId, actor.clinicId],
  );
  return result.rows.map((row) => ({ id: row.id, parentCommentId: row.parent_comment_id, body: row.body, authorRole: row.author_role, status: row.status, mentionedName: row.mentioned_name, assigneeName: row.assignee_name, createdAt: row.created_at }));
}

export async function createComment(client: PoolClient, _actor: PilotActor, entryId: string, body: string) {
  const result = await client.query<{ comment_id: string }>("SELECT create_entry_comment($1, $2, NULL, NULL, NULL) AS comment_id", [entryId, body]);
  return result.rows[0];
}

export async function setCommentResolution(client: PoolClient, _actor: PilotActor, commentId: string, resolved: boolean) {
  const result = await client.query<{ comment_id: string }>("SELECT set_entry_comment_resolution($1, $2) AS comment_id", [commentId, resolved]);
  return result.rows[0];
}

export async function listEntryVersions(client: PoolClient, actor: PilotActor, entryId: string): Promise<EntryVersion[]> {
  const result = await client.query<{ id: string; version: number; content: string; changed_at: string; changed_by_role: string }>(
    `SELECT v.id, v.version, v.content, v.changed_at::text, e.author_role AS changed_by_role
     FROM entry_versions v JOIN care_entries e ON e.id = v.entry_id
     WHERE v.entry_id = $1 AND v.clinic_id = $2 ORDER BY v.version DESC`, [entryId, actor.clinicId],
  );
  return result.rows.map((row) => ({ id: row.id, version: row.version, content: row.content, changedAt: row.changed_at, changedByRole: row.changed_by_role }));
}

export async function revertEntryVersion(client: PoolClient, _actor: PilotActor, entryId: string, sourceVersion: number, expectedVersion: number) {
  const result = await client.query<{ version_id: string }>("SELECT revert_entry_to_version($1, $2, $3) AS version_id", [entryId, sourceVersion, expectedVersion]);
  return result.rows[0];
}

export async function createAiScribedEntry(client: PoolClient, _actor: PilotActor, patientId: string, type: "ai_doctor_consult_summary" | "ai_nurse_consult_summary" | "ai_patient_session_summary", redactedSource: string) {
  const result = await client.query<{ care_entry_id: string; entry_version_id: string; provenance_pointer: string }>("SELECT * FROM create_ai_scribed_entry($1, $2::entry_type, $3)", [patientId, type, redactedSource]);
  return result.rows[0];
}

export async function publishPatientSummary(client: PoolClient, _actor: PilotActor, patientId: string, title: string, content: string) {
  const result = await client.query<{ summary_id: string }>("SELECT publish_patient_summary($1, $2, $3) AS summary_id", [patientId, title, content]);
  return result.rows[0];
}

export async function listMyPatientSummaries(client: PoolClient) {
  const result = await client.query<{ patient_id: string; display_label: string; title: string; content: string; updated_at: string }>("SELECT patient_id, display_label, title, content, updated_at::text FROM get_my_patient_summaries()");
  return result.rows.map((row) => ({ patientId: row.patient_id, displayLabel: row.display_label, title: row.title, content: row.content, updatedAt: row.updated_at }));
}
