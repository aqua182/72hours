import { z } from "zod";
import { type VerifiedIdentity } from "../auth/verified-identity";
import { verifyPilotRequest } from "../auth/verified-pilot-request";
import { createPilotPool, withPilotActor } from "../db/actor-transaction";
import { listClinicPatients } from "../db/patient-directory-repository";

type Dependencies = {
  verifyIdentity: (request: Request) => Promise<VerifiedIdentity>;
  runAsActor: typeof withPilotActor;
  pool: ReturnType<typeof createPilotPool>;
};

let applicationPool: ReturnType<typeof createPilotPool> | undefined;

export function createPatientDirectoryHandler(dependencies: Dependencies) {
  return async function getPatients(request: Request, clinicId: string) {
    if (!z.string().uuid().safeParse(clinicId).success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    let identity: VerifiedIdentity;
    try {
      identity = await dependencies.verifyIdentity(request);
    } catch {
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    try {
      const patients = await dependencies.runAsActor(dependencies.pool, identity, clinicId, listClinicPatients);
      return Response.json({ patients });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("forbidden clinic membership") || error.message.includes("authenticated subject is not provisioned"))) {
        return Response.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
    }
  };
}

export async function handleGetClinicPatients(request: Request, clinicId: string) {
  applicationPool ??= createPilotPool();
  return createPatientDirectoryHandler({ pool: applicationPool, runAsActor: withPilotActor, verifyIdentity: verifyPilotRequest })(request, clinicId);
}
