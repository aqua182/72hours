import { handleEntryRevert } from "../../../../../src/http/collaboration-handlers";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ entryId: string }> }) { return handleEntryRevert(request, (await context.params).entryId); }
