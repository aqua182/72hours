import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { requireRole, session } from "@/server/auth";
import { row, run } from "@/server/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await session();
  try { requireRole(user, "staff", "clinician"); } catch { return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); }
  const { id } = await context.params;
  const entry = row<{ author_role: string; current_version: number }>("SELECT author_role, current_version FROM entries WHERE id=?", [id]);
  const { version } = await request.json();
  if (!entry || entry.author_role !== user!.role) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const target = row<{ content: string }>("SELECT content FROM entry_versions WHERE entry_id=? AND version=?", [id, version]);
  if (!target) return NextResponse.json({ error: "VERSION_NOT_FOUND" }, { status: 404 });
  const next = entry.current_version + 1;
  run("INSERT INTO entry_versions VALUES (?, ?, ?, ?, ?, ?)", [`${id}-v${next}`, id, next, target.content, user!.id, new Date().toISOString()]);
  run("UPDATE entries SET current_version=? WHERE id=?", [next, id]);
  run("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?)", [crypto.randomUUID(), user!.id, "reverted_entry", id, JSON.stringify({ restoredVersion: version, newVersion: next }), new Date().toISOString()]);
  return NextResponse.json({ ok: true, version: next });
}
