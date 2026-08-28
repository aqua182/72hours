import { handleGetEvidenceWorkbench, handleReviewHighlight } from "../../../../src/http/evidence-workbench-handler";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ highlightId: string }> }) {
  const { highlightId } = await context.params;
  return handleGetEvidenceWorkbench(request, highlightId);
}

export async function PATCH(request: Request, context: { params: Promise<{ highlightId: string }> }) {
  const { highlightId } = await context.params;
  return handleReviewHighlight(request, highlightId);
}
