import { z } from "zod";
import { verifyOidcBearer, type VerifiedIdentity } from "../auth/verified-identity";
import { createPilotPool, withPilotActor } from "../db/actor-transaction";
import { appendCareEntryVersion } from "../db/care-entry-repository";

const appendEntryVersionRequest = z.object({
  clinicId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
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
  if (message.includes("entry not found")) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (message.includes("version conflict")) return Response.json({ error: "VERSION_CONFLICT" }, { status: 409 });
  if (message.includes("role cannot edit")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (message.includes("content required")) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
}

export function createAppendCareEntryVersionHandler(dependencies: Dependencies) {
  return async function patchCareEntry(request: Request, entryId: string) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "INVALID_JSON" }, { status: 400 });
    }

    const parsed = appendEntryVersionRequest.safeParse(body);
    if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });

    let identity: VerifiedIdentity;
    try {
      identity = await dependencies.verifyIdentity(request.headers.get("authorization"));
    } catch {
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    try {
      const result = await dependencies.runAsActor(dependencies.pool, identity, parsed.data.clinicId, (client, actor) => appendCareEntryVersion(client, actor, entryId, parsed.data.expectedVersion, parsed.data.content));
      return Response.json({ entryVersionId: result.entryVersionId }, { status: 201 });
    } catch (error) {
      return databaseErrorResponse(error);
    }
  };
}

export async function handleAppendCareEntryVersion(request: Request, entryId: string) {
  applicationPool ??= createPilotPool();
  return createAppendCareEntryVersionHandler({ pool: applicationPool, runAsActor: withPilotActor, verifyIdentity: verifyOidcBearer })(request, entryId);
}
