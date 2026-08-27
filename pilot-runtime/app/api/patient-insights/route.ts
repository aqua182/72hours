import { handlePatientInsight } from "../../../src/http/collaboration-handlers";

export async function POST(request: Request) { return handlePatientInsight(request); }
