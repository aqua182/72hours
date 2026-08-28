import { handleAiScribedEntry } from "../../../src/http/collaboration-handlers";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleAiScribedEntry(request); }
