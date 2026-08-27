import { handleCareNoteEvents } from "../../../../../src/http/care-note-events-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ patientId: string }> }) { return handleCareNoteEvents(request, (await context.params).patientId); }
