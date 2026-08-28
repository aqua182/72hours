import { handleEntryVersions } from "../../../../../src/http/collaboration-handlers";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ entryId: string }> }) { return handleEntryVersions(request, (await context.params).entryId); }
