import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { requireRole, session } from "@/server/auth";
import { run } from "@/server/db";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await session();
  try { requireRole(user, "staff", "clinician", "admin"); } catch { return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); }
  const { id } = await context.params;
  run("UPDATE tasks SET assignee_id=? WHERE id=? AND assignee_id IS NULL", [user!.id, id]);
  return NextResponse.json({ ok: true });
}
