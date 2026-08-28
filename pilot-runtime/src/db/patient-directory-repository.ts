import type { PoolClient } from "pg";
import type { PilotActor } from "./actor-transaction";

export type PatientDirectoryItem = { id: string; displayLabel: string };

export async function listClinicPatients(client: PoolClient, actor: PilotActor): Promise<PatientDirectoryItem[]> {
  const result = await client.query<{ id: string; display_label: string }>(
    `SELECT id, display_label
     FROM patients
     WHERE clinic_id = $1
     ORDER BY created_at ASC, id ASC`,
    [actor.clinicId],
  );
  return result.rows.map((row) => ({ id: row.id, displayLabel: row.display_label }));
}
