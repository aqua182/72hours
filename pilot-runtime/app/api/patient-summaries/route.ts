import { handleMyPatientSummaries } from "../../../src/http/collaboration-handlers";
export const runtime = "nodejs";
export async function GET(request: Request) { return handleMyPatientSummaries(request); }
