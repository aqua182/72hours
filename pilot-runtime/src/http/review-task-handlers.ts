import { z } from "zod";
import { verifyOidcBearer, type VerifiedIdentity } from "../auth/verified-identity";
import { createPilotPool, withPilotActor } from "../db/actor-transaction";
import { claimReviewTask, closeReviewTask, type ReviewTaskClosureReason } from "../db/review-task-repository";

const claimRequest = z.object({ clinicId: z.string().uuid() });
const closeRequest = z.object({
  clinicId: z.string().uuid(),
  reason: z.enum(["clinician_confirmed", "clinician_rejected", "not_clinically_relevant", "source_outdated", "rule_false_positive"]),
});

type Dependencies = {
  verifyIdentity: (authorization: string | null) => Promise<VerifiedIdentity>;
  runAsActor: typeof withPilotActor;
  pool: ReturnType<typeof createPilotPool>;
};

let applicationPool: ReturnType<typeof createPilotPool> | undefined;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("task not found")) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (message.includes("only a clinician") || message.includes("not a review-required")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (message.includes("not open") || message.includes("must be claimed")) return Response.json({ error: "TASK_STATE_CONFLICT" }, { status: 409 });
  if (message.includes("closure reason")) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
}

async function verifiedIdentity(request: Request, dependencies: Dependencies) {
  try {
    return await dependencies.verifyIdentity(request.headers.get("authorization"));
  } catch {
    return undefined;
  }
}

export function createClaimReviewTaskHandler(dependencies: Dependencies) {
  return async function claim(request: Request, taskId: string) {
    const parsed = claimRequest.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const identity = await verifiedIdentity(request, dependencies);
    if (!identity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    try {
      const result = await dependencies.runAsActor(dependencies.pool, identity, parsed.data.clinicId, (client, actor) => claimReviewTask(client, actor, taskId));
      return Response.json({ taskId: result.taskId, status: "claimed" }, { status: 200 });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createCloseReviewTaskHandler(dependencies: Dependencies) {
  return async function close(request: Request, taskId: string) {
    const parsed = closeRequest.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const identity = await verifiedIdentity(request, dependencies);
    if (!identity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    try {
      const result = await dependencies.runAsActor(dependencies.pool, identity, parsed.data.clinicId, (client, actor) => closeReviewTask(client, actor, taskId, parsed.data.reason as ReviewTaskClosureReason));
      return Response.json({ taskId: result.taskId, status: "closed", reason: result.reason }, { status: 200 });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function pool() {
  applicationPool ??= createPilotPool();
  return applicationPool;
}

export async function handleClaimReviewTask(request: Request, taskId: string) {
  return createClaimReviewTaskHandler({ pool: pool(), runAsActor: withPilotActor, verifyIdentity: verifyOidcBearer })(request, taskId);
}

export async function handleCloseReviewTask(request: Request, taskId: string) {
  return createCloseReviewTaskHandler({ pool: pool(), runAsActor: withPilotActor, verifyIdentity: verifyOidcBearer })(request, taskId);
}
