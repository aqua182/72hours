import { handleClinicCollaborators } from "../../../../../src/http/collaboration-handlers";

export async function GET(request: Request, context: { params: Promise<{ clinicId: string }> }) { return handleClinicCollaborators(request, (await context.params).clinicId); }
