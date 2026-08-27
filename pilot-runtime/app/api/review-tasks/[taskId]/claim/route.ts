import { handleClaimReviewTask } from "../../../../../src/http/review-task-handlers";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  return handleClaimReviewTask(request, taskId);
}
