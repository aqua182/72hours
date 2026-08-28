import { type VerifiedIdentity } from "../auth/verified-identity";
import { createPilotPool, withAuthenticatedPilotActor } from "../db/actor-transaction";
import { listClinicMemberships } from "../db/membership-repository";

type Dependencies = {
  verifyIdentity: (request: Request) => Promise<VerifiedIdentity>;
  runAsAuthenticatedActor: typeof withAuthenticatedPilotActor;
  pool: ReturnType<typeof createPilotPool>;
};

let applicationPool: ReturnType<typeof createPilotPool> | undefined;

export function createMembershipHandler(dependencies: Dependencies) {
  return async function getMemberships(request: Request) {
    let identity: VerifiedIdentity;
    try {
      identity = await dependencies.verifyIdentity(request);
    } catch {
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    try {
      const memberships = await dependencies.runAsAuthenticatedActor(dependencies.pool, identity, listClinicMemberships);
      return Response.json({ memberships });
    } catch (error) {
      if (error instanceof Error && error.message.includes("authenticated subject is not provisioned")) {
        return Response.json({ error: "NOT_PROVISIONED" }, { status: 403 });
      }
      return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
    }
  };
}

export async function handleGetMemberships(request: Request) {
  applicationPool ??= createPilotPool();
  const { verifyPilotRequest } = await import("../auth/verified-pilot-request");
  return createMembershipHandler({ pool: applicationPool, runAsAuthenticatedActor: withAuthenticatedPilotActor, verifyIdentity: verifyPilotRequest })(request);
}
