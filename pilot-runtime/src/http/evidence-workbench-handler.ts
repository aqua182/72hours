import { z } from "zod";
import { verifyOidcBearer, type VerifiedIdentity } from "../auth/verified-identity";
import { createPilotPool, withPilotActor } from "../db/actor-transaction";
import { getEvidenceWorkbench, reviewHighlight, type DismissalReason, type HighlightDecision } from "../db/evidence-workbench-repository";

const clinicId = z.string().uuid();
const reviewRequest = z.object({
  clinicId,
  decision: z.enum(["accepted", "rejected", "dismissed", "pinned"]),
  dismissalReason: z.enum(["not_clinically_relevant", "source_outdated", "rule_false_positive"]).optional(),
});

type Dependencies = {
  verifyIdentity: (authorization: string | null) => Promise<VerifiedIdentity>;
  runAsActor: typeof withPilotActor;
  pool: ReturnType<typeof createPilotPool>;
};

let applicationPool: ReturnType<typeof createPilotPool> | undefined;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("highlight not found")) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (message.includes("only a clinician")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (message.includes("dismissal reason") || message.includes("invalid highlight decision")) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
}

async function identityFor(request: Request, dependencies: Dependencies) {
  try {
    return await dependencies.verifyIdentity(request.headers.get("authorization"));
  } catch {
    return undefined;
  }
}

export function createEvidenceWorkbenchHandler(dependencies: Dependencies) {
  return {
    async get(request: Request, highlightId: string) {
      const parsedClinic = clinicId.safeParse(new URL(request.url).searchParams.get("clinicId"));
      if (!parsedClinic.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
      const identity = await identityFor(request, dependencies);
      if (!identity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      try {
        const workbench = await dependencies.runAsActor(dependencies.pool, identity, parsedClinic.data, (client, actor) => getEvidenceWorkbench(client, actor, highlightId));
        return Response.json(workbench);
      } catch (error) {
        return errorResponse(error);
      }
    },
    async patch(request: Request, highlightId: string) {
      const parsed = reviewRequest.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
      const identity = await identityFor(request, dependencies);
      if (!identity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      try {
        const result = await dependencies.runAsActor(dependencies.pool, identity, parsed.data.clinicId, (client, actor) => reviewHighlight(client, actor, highlightId, parsed.data.decision as HighlightDecision, parsed.data.dismissalReason as DismissalReason | undefined));
        return Response.json(result, { status: 200 });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

function pool() {
  applicationPool ??= createPilotPool();
  return applicationPool;
}

export async function handleGetEvidenceWorkbench(request: Request, highlightId: string) {
  return createEvidenceWorkbenchHandler({ pool: pool(), runAsActor: withPilotActor, verifyIdentity: verifyOidcBearer }).get(request, highlightId);
}

export async function handleReviewHighlight(request: Request, highlightId: string) {
  return createEvidenceWorkbenchHandler({ pool: pool(), runAsActor: withPilotActor, verifyIdentity: verifyOidcBearer }).patch(request, highlightId);
}
