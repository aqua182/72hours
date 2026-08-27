import assert from "node:assert/strict";
import { createMembershipHandler } from "../src/http/membership-handler";
import { type withAuthenticatedPilotActor } from "../src/db/actor-transaction";

const identity = { subject: "auth0|synthetic-user", issuer: "https://issuer/", audience: "https://audience" };
const emptyMembershipRun: typeof withAuthenticatedPilotActor = async (_pool, _identity, work) => {
  return work({ query: async () => ({ rows: [], rowCount: 0 }) } as never, { userId: "synthetic-user-id" });
};

async function run() {
  const unauthenticated = createMembershipHandler({
    pool: {} as never,
    verifyIdentity: async () => { throw new Error("no session"); },
    runAsAuthenticatedActor: emptyMembershipRun,
  });
  assert.equal((await unauthenticated(new Request("http://localhost/api/memberships"))).status, 401);

  const notProvisioned = createMembershipHandler({
    pool: {} as never,
    verifyIdentity: async () => identity,
    runAsAuthenticatedActor: async () => { throw new Error("authenticated subject is not provisioned"); },
  });
  const blocked = await notProvisioned(new Request("http://localhost/api/memberships"));
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: "NOT_PROVISIONED" });

  const member = createMembershipHandler({
    pool: {} as never,
    verifyIdentity: async () => identity,
    runAsAuthenticatedActor: emptyMembershipRun,
  });
  const response = await member(new Request("http://localhost/api/memberships"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { memberships: [] });
  process.stdout.write("Membership authorization handler tests passed.\n");
}

void run().catch((error: unknown) => { console.error(error); process.exit(1); });
