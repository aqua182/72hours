import type { PoolClient } from "pg";
import type { PilotActor } from "./actor-transaction";

export async function appendCareEntryVersion(client: PoolClient, actor: PilotActor, entryId: string, expectedVersion: number, content: string) {
  const result = await client.query<{ version_id: string }>("SELECT append_entry_version($1, $2, $3) AS version_id", [entryId, expectedVersion, content]);
  if (result.rowCount !== 1) throw new Error("entry version append did not return a version");
  return { entryVersionId: result.rows[0].version_id, clinicId: actor.clinicId };
}
