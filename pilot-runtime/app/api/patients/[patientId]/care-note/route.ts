import { handleGetCareNote } from "../../../../../src/http/care-note-read-handler";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await context.params;
  return handleGetCareNote(request, patientId);
}
