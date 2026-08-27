import { z } from "zod";
import { type VerifiedIdentity } from "../auth/verified-identity";
import { verifyPilotRequest } from "../auth/verified-pilot-request";
import { createPilotPool, withAuthenticatedPilotActor, withPilotActor } from "../db/actor-transaction";
import { createAiScribedEntry, createComment, listEntryComments, listEntryVersions, listMyPatientSummaries, publishPatientSummary, revertEntryVersion, setCommentResolution } from "../db/collaboration-repository";
import { redactForModel } from "../ai/redaction";

const clinicId = z.string().uuid();
const entryId = z.string().uuid();
const commentRequest = z.object({ clinicId, body: z.string().trim().min(1).max(4_000) });
const resolutionRequest = z.object({ clinicId, resolved: z.boolean() });
const revertRequest = z.object({ clinicId, sourceVersion: z.number().int().positive(), expectedVersion: z.number().int().positive() });
const aiRequest = z.object({ clinicId, patientId: z.string().uuid(), type: z.enum(["ai_doctor_consult_summary", "ai_nurse_consult_summary", "ai_patient_session_summary"]), sourceText: z.string().trim().min(1).max(20_000) });
const summaryRequest = z.object({ clinicId, title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(10_000) });

let applicationPool: ReturnType<typeof createPilotPool> | undefined;
function pool() { applicationPool ??= createPilotPool(); return applicationPool; }
async function identity(request: Request): Promise<VerifiedIdentity | undefined> { try { return await verifyPilotRequest(request); } catch { return undefined; } }
function message(error: unknown) { return error instanceof Error ? error.message : ""; }
function failure(error: unknown) {
  const text = message(error);
  if (text.includes("not found")) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (text.includes("version conflict")) return Response.json({ error: "VERSION_CONFLICT" }, { status: 409 });
  if (text.includes("may not") || text.includes("only a clinician") || text.includes("forbidden clinic membership") || text.includes("not provisioned") || text.includes("not a clinic member")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (text.includes("required") || text.includes("invalid")) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
}

export async function handleEntryComments(request: Request, targetEntryId: string) {
  if (!entryId.safeParse(targetEntryId).success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const actorIdentity = await identity(request); if (!actorIdentity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (request.method === "GET") {
    const parsedClinic = clinicId.safeParse(new URL(request.url).searchParams.get("clinicId")); if (!parsedClinic.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    try { return Response.json({ comments: await withPilotActor(pool(), actorIdentity, parsedClinic.data, (client, actor) => listEntryComments(client, actor, targetEntryId)) }); } catch (error) { return failure(error); }
  }
  const parsed = commentRequest.safeParse(await request.json().catch(() => undefined)); if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  try { return Response.json(await withPilotActor(pool(), actorIdentity, parsed.data.clinicId, (client, actor) => createComment(client, actor, targetEntryId, parsed.data.body)), { status: 201 }); } catch (error) { return failure(error); }
}

export async function handleEntryVersions(request: Request, targetEntryId: string) {
  const actorIdentity = await identity(request); if (!actorIdentity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const parsedClinic = clinicId.safeParse(new URL(request.url).searchParams.get("clinicId")); if (!parsedClinic.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  try { return Response.json({ versions: await withPilotActor(pool(), actorIdentity, parsedClinic.data, (client, actor) => listEntryVersions(client, actor, targetEntryId)) }); } catch (error) { return failure(error); }
}

export async function handleEntryRevert(request: Request, targetEntryId: string) {
  const parsed = revertRequest.safeParse(await request.json().catch(() => undefined)); if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const actorIdentity = await identity(request); if (!actorIdentity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  try { return Response.json(await withPilotActor(pool(), actorIdentity, parsed.data.clinicId, (client, actor) => revertEntryVersion(client, actor, targetEntryId, parsed.data.sourceVersion, parsed.data.expectedVersion))); } catch (error) { return failure(error); }
}

export async function handleCommentResolution(request: Request, commentId: string) {
  const parsed = resolutionRequest.safeParse(await request.json().catch(() => undefined)); if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const actorIdentity = await identity(request); if (!actorIdentity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  try { return Response.json(await withPilotActor(pool(), actorIdentity, parsed.data.clinicId, (client, actor) => setCommentResolution(client, actor, commentId, parsed.data.resolved))); } catch (error) { return failure(error); }
}

export async function handleAiScribedEntry(request: Request) {
  const parsed = aiRequest.safeParse(await request.json().catch(() => undefined)); if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const actorIdentity = await identity(request); if (!actorIdentity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const redacted = redactForModel(parsed.data.sourceText).redactedText;
  try { return Response.json(await withPilotActor(pool(), actorIdentity, parsed.data.clinicId, (client, actor) => createAiScribedEntry(client, actor, parsed.data.patientId, parsed.data.type, redacted)), { status: 201 }); } catch (error) { return failure(error); }
}

export async function handlePublishPatientSummary(request: Request, patientId: string) {
  const parsed = summaryRequest.safeParse(await request.json().catch(() => undefined)); if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const actorIdentity = await identity(request); if (!actorIdentity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  try { return Response.json(await withPilotActor(pool(), actorIdentity, parsed.data.clinicId, (client, actor) => publishPatientSummary(client, actor, patientId, parsed.data.title, parsed.data.content))); } catch (error) { return failure(error); }
}

export async function handleMyPatientSummaries(request: Request) {
  const actorIdentity = await identity(request); if (!actorIdentity) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  try { return Response.json({ summaries: await withAuthenticatedPilotActor(pool(), actorIdentity, (client) => listMyPatientSummaries(client)) }); } catch (error) { return failure(error); }
}
