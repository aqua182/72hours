import { handleAppendCareEntryVersion } from "../../../../src/http/append-care-entry-version-handler";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await context.params;
  return handleAppendCareEntryVersion(request, entryId);
}
