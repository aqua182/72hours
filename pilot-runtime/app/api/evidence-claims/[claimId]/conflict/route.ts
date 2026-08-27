import { handleMarkClaimConflict } from "../../../../../src/http/collaboration-handlers";

export async function POST(request: Request, context: { params: Promise<{ claimId: string }> }) { return handleMarkClaimConflict(request, (await context.params).claimId); }
