import { Pool, type PoolClient } from "pg";
import type { VerifiedIdentity } from "../auth/verified-identity";

export type PilotActor = { userId: string; clinicId: string; role: "staff" | "clinician" | "admin" };
export type AuthenticatedPilotActor = Pick<PilotActor, "userId">;

export function createPilotPool(connectionString = process.env.PILOT_DATABASE_URL) {
  if (!connectionString) throw new Error("PILOT_DATABASE_URL is required in the Pilot Runtime");
  return new Pool({ connectionString, max: 10, application_name: "nightingale-pilot-runtime" });
}

/**
 * The only database entry point for an HTTP request. The identity subject has
 * already been verified by OIDC; the database maps it to a provisioned user,
 * scopes app.user_id with SET LOCAL, and RLS verifies clinic membership.
 */
export async function withAuthenticatedPilotActor<T>(pool: Pool, identity: VerifiedIdentity, work: (client: PoolClient, actor: AuthenticatedPilotActor) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identityResult = await client.query<{ actor_id: string }>("SELECT establish_authenticated_actor($1) AS actor_id", [identity.subject]);
    if (identityResult.rowCount !== 1) throw new Error("authenticated subject is not provisioned");
    const result = await work(client, { userId: identityResult.rows[0].actor_id });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withPilotActor<T>(pool: Pool, identity: VerifiedIdentity, clinicId: string, work: (client: PoolClient, actor: PilotActor) => Promise<T>) {
  return withAuthenticatedPilotActor(pool, identity, async (client, authenticatedActor) => {
    const membership = await client.query<{ role: PilotActor["role"] }>("SELECT role FROM clinic_memberships WHERE clinic_id=$1 AND user_id=$2 AND active", [clinicId, authenticatedActor.userId]);
    if (membership.rowCount !== 1) throw new Error("forbidden clinic membership");
    return work(client, { userId: authenticatedActor.userId, clinicId, role: membership.rows[0].role });
  });
}
