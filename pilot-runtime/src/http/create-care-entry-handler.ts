import { z } from "zod";
import { verifyOidcBearer, type VerifiedIdentity } from "../auth/verified-identity";
import { createPilotPool, withPilotActor } from "../db/actor-transaction";
import { createCareEntry } from "../db/care-entry-repository";

const createCareEntryRequest = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  type: z.enum(["staff_note", "clinician_note"]),
  content: z.string().trim().min(1).max(20_000),
});

type Dependencies = {
  verifyIdentity: (authorization: string | null) => Promise<VerifiedIdentity>;
  runAsActor: typeof withPilotActor;
  pool: ReturnType<typeof createPilotPool>;
};

let applicationPool: ReturnType<typeof createPilotPool> | undefined;

function databaseErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("patient not found")) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (message.includes("forbidden clinic membership") || message.includes("may create")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (message.includes("content required") || message.includes("patient-visible")) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
}

export function createCareEntryHandler(dependencies: Dependencies) {
  return async function postCareEntry(request: Request) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "INVALID_JSON" }, { status: 400 });
    }

    const parsed = createCareEntryRequest.safeParse(body);
    if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });

    let identity: VerifiedIdentity;
    try {
      identity = await dependencies.verifyIdentity(request.headers.get("authorization"));
    } catch {
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    try {
      const result = await dependencies.runAsActor(dependencies.pool, identity, parsed.data.clinicId, (client, actor) => createCareEntry(client, actor, parsed.data));
      return Response.json({ entryId: result.entryId, entryVersionId: result.entryVersionId }, { status: 201 });
    } catch (error) {
      return databaseErrorResponse(error);
    }
  };
}

/**
 * Route adapters call this function; it verifies a real OIDC bearer token
 * before opening the RLS-scoped transaction. Keeping it outside the Demo
 * avoids ever mounting Pilot authorization on the synthetic app.
 */
export async function handleCreateCareEntry(request: Request) {
  applicationPool ??= createPilotPool();
  return createCareEntryHandler({ pool: applicationPool, runAsActor: withPilotActor, verifyIdentity: verifyOidcBearer })(request);
}
