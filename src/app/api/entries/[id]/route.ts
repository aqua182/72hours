import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { requireRole, session } from "@/server/auth";
import { row, run } from "@/server/db";

type Entry = { id: string; author_role: string; current_version: number };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await session();
  try { requireRole(user, "patient", "staff", "clinician"); } catch { return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); }
  const { id } = await context.params;
  const entry = row<Entry>("SELECT id, author_role, current_version FROM entries WHERE id=?", [id]);
  if (!entry || entry.author_role !== user!.role) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { content, expectedVersion } = await request.json();
  if (!content || expectedVersion !== entry.current_version) return NextResponse.json({ error: "VERSION_CONFLICT", currentVersion: entry.current_version }, { status: 409 });
  const next = entry.current_version + 1;
  const versionId = `${id}-v${next}`;
  run("INSERT INTO entry_versions VALUES (?, ?, ?, ?, ?, ?)", [versionId, id, next, content, user!.id, new Date().toISOString()]);
  run("UPDATE entries SET current_version=? WHERE id=?", [next, id]);
  run("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?)", [crypto.randomUUID(), user!.id, "edited_entry", id, JSON.stringify({ from: entry.current_version, to: next }), new Date().toISOString()]);
  return NextResponse.json({ ok: true, version: next });
}
