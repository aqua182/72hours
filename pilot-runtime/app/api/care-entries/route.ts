import { handleCreateCareEntry } from "../../../src/http/create-care-entry-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleCreateCareEntry(request);
}
