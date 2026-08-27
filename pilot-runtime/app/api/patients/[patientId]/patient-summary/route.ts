import { handlePublishPatientSummary } from "../../../../../src/http/collaboration-handlers";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ patientId: string }> }) { return handlePublishPatientSummary(request, (await context.params).patientId); }
