import { handlePatientInsight } from "../../../src/http/collaboration-handlers";

export const runtime = "nodejs";
export async function GET(request: Request) { return handlePatientInsight(request); }
export async function POST(request: Request) { return handlePatientInsight(request); }
