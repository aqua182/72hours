import type { PoolClient } from "pg";
import type { PilotActor } from "./actor-transaction";

export type NewCareEntry = {
  patientId: string;
  type: "staff_note" | "clinician_note";
  content: string;
};

export async function createCareEntry(client: PoolClient, actor: PilotActor, entry: NewCareEntry) {
  const result = await client.query<{ care_entry_id: string; entry_version_id: string }>(
    "SELECT * FROM create_care_entry($1, $2::entry_type, 'internal'::entry_visibility, $3, NULL)",
    [entry.patientId, entry.type, entry.content],
  );
  if (result.rowCount !== 1) throw new Error("care entry creation did not return an entry");
  return { entryId: result.rows[0].care_entry_id, entryVersionId: result.rows[0].entry_version_id, clinicId: actor.clinicId };
}

export async function appendCareEntryVersion(client: PoolClient, actor: PilotActor, entryId: string, expectedVersion: number, content: string) {
  const result = await client.query<{ version_id: string }>("SELECT append_entry_version($1, $2, $3) AS version_id", [entryId, expectedVersion, content]);
  if (result.rowCount !== 1) throw new Error("entry version append did not return a version");
  return { entryVersionId: result.rows[0].version_id, clinicId: actor.clinicId };
}
