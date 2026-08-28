import { handleGetMemberships } from "../../../src/http/membership-handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleGetMemberships(request);
}
