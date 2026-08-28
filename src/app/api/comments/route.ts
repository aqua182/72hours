import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { requireRole, session } from "@/server/auth";
import { run } from "@/server/db";

export async function POST(request: Request) {
  const user = await session();
  try { requireRole(user, "staff", "clinician"); } catch { return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); }
  const { entryId, content, assigneeId } = await request.json();
  if (!entryId || !content) return NextResponse.json({ error: "invalid comment" }, { status: 400 });
  run("INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)", [crypto.randomUUID(), entryId, user!.id, content, "unresolved", assigneeId ?? null, new Date().toISOString()]);
  return NextResponse.json({ ok: true });
}
