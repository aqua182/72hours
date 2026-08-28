import type { PoolClient } from "pg";
import type { AuthenticatedPilotActor } from "./actor-transaction";

export type ClinicMembershipSummary = {
  clinicId: string;
  clinicName: string;
  role: "staff" | "clinician" | "admin";
};

/**
 * Lists only memberships that Postgres can already see through the current
 * transaction's authenticated actor. This is a discovery read, never a way
 * for a browser to select or create a clinic relationship.
 */
export async function listClinicMemberships(client: PoolClient, actor: AuthenticatedPilotActor): Promise<ClinicMembershipSummary[]> {
  const result = await client.query<{ clinic_id: string; clinic_name: string; role: ClinicMembershipSummary["role"] }>(
    `SELECT m.clinic_id, c.name AS clinic_name, m.role
     FROM clinic_memberships m
     JOIN clinics c ON c.id = m.clinic_id
     WHERE m.user_id = $1 AND m.active
     ORDER BY c.name ASC`,
    [actor.userId],
  );
  return result.rows.map((row) => ({ clinicId: row.clinic_id, clinicName: row.clinic_name, role: row.role }));
}
