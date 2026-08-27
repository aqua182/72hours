export const runtime = "nodejs";

export async function GET() {
  return Response.json({ service: "nightingale-pilot-runtime", status: "ok" });
}
