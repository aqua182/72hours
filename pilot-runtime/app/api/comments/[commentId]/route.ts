import { handleCommentResolution } from "../../../../src/http/collaboration-handlers";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ commentId: string }> }) { return handleCommentResolution(request, (await context.params).commentId); }
