import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { requireRole, session } from "@/server/auth";
import { run } from "@/server/db";

export async function POST() {
  const user = await session();
  try { requireRole(user, "admin"); } catch { return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); }
  run("UPDATE tasks SET assignee_id=NULL, status='open'");
  run("UPDATE highlights SET status='suggested'");
  run("UPDATE evidence_claims SET state='unverified'");
  run("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?)", [crypto.randomUUID(), user!.id, "reset_demo_state", "patient-ava", JSON.stringify({ synthetic: true }), new Date().toISOString()]);
  return NextResponse.json({ ok: true });
}
