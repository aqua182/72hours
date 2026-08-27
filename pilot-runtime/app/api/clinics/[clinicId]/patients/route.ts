import { handleGetClinicPatients } from "../../../../../src/http/patient-directory-handler";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await context.params;
  return handleGetClinicPatients(request, clinicId);
}
