import { handleEntryComments } from "../../../../../src/http/collaboration-handlers";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ entryId: string }> }) { return handleEntryComments(request, (await context.params).entryId); }
export async function POST(request: Request, context: { params: Promise<{ entryId: string }> }) { return handleEntryComments(request, (await context.params).entryId); }
