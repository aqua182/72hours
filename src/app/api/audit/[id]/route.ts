import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { requireRole, session } from "@/server/auth";
import { rows } from "@/server/db";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await session();
  try { requireRole(user, "clinician", "admin"); } catch { return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); }
  const { id } = await context.params;
  const events = rows("SELECT actor_id as actorId, action, target_id as targetId, metadata, created_at as createdAt FROM audit_logs WHERE target_id=? ORDER BY created_at DESC", [id]);
  return NextResponse.json({ events });
}
