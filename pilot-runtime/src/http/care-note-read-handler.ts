import { z } from "zod";
import { type VerifiedIdentity } from "../auth/verified-identity";
import { verifyPilotRequest } from "../auth/verified-pilot-request";
import { createPilotPool, withPilotActor } from "../db/actor-transaction";
import { getCareNote } from "../db/care-note-read-repository";

type Dependencies = {
  verifyIdentity: (request: Request) => Promise<VerifiedIdentity>;
  runAsActor: typeof withPilotActor;
  pool: ReturnType<typeof createPilotPool>;
};

let applicationPool: ReturnType<typeof createPilotPool> | undefined;

export function createCareNoteReadHandler(dependencies: Dependencies) {
  return async function get(request: Request, patientId: string) {
    const clinicId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("clinicId"));
    if (!clinicId.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    let identity: VerifiedIdentity;
    try {
      identity = await dependencies.verifyIdentity(request);
    } catch {
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    try {
      const careNote = await dependencies.runAsActor(dependencies.pool, identity, clinicId.data, (client, actor) => getCareNote(client, actor, patientId));
      return Response.json(careNote);
    } catch (error) {
      if (error instanceof Error && error.message.includes("patient not found")) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
      if (error instanceof Error && (error.message.includes("forbidden clinic membership") || error.message.includes("authenticated subject is not provisioned"))) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
      return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
    }
  };
}

export async function handleGetCareNote(request: Request, patientId: string) {
  applicationPool ??= createPilotPool();
  return createCareNoteReadHandler({ pool: applicationPool, runAsActor: withPilotActor, verifyIdentity: verifyPilotRequest })(request, patientId);
}
