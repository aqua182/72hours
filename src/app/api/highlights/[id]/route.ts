import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { requireRole, session } from "@/server/auth";
import { row, run } from "@/server/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await session();
  try { requireRole(user, "clinician", "staff"); } catch { return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); }
  const { id } = await context.params;
  const { action, dismissReason } = await request.json();
  const h = row<{ claim_id: string; entity: string }>("SELECT h.claim_id, c.entity FROM highlights h JOIN evidence_claims c ON c.id=h.claim_id WHERE h.id=?", [id]);
  if (!h || !["accepted", "rejected", "pinned", "dismissed"].includes(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  if (action === "dismissed" && !dismissReason) return NextResponse.json({ error: "dismiss reason required" }, { status: 400 });
  run("UPDATE highlights SET status=? WHERE id=?", [action, id]);
  if (action === "accepted" && user?.role === "clinician") run("UPDATE evidence_claims SET state='clinician-confirmed' WHERE id=?", [h.claim_id]);
  if (["accepted", "pinned"].includes(action)) run("UPDATE highlights SET importance=importance+5 WHERE id != ? AND status='suggested' AND claim_id IN (SELECT id FROM evidence_claims WHERE entity=?)", [id, h.entity]);
  run("INSERT INTO importance_feedback VALUES (?, ?, ?, ?, ?, ?)", [crypto.randomUUID(), id, h.entity, action, user!.id, new Date().toISOString()]);
  run("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?)", [crypto.randomUUID(), user!.id, action, id, JSON.stringify({ dismissReason: dismissReason ?? null }), new Date().toISOString()]);
  return NextResponse.json({ ok: true });
}
