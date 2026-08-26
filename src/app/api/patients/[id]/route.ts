import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { row, rows } from "@/server/db";
import { canViewInternal, session } from "@/server/auth";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await session();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await context.params;
  const patient = row<{ id: string; clinicId: string; displayName: string; dob: string }>("SELECT id, clinic_id as clinicId, display_name as displayName, dob FROM patients WHERE id = ? AND clinic_id = ?", [id, user.clinicId]);
  if (!patient) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const internal = canViewInternal(user);
  const rawEntries = rows<any>("SELECT e.*, v.id as versionId, v.content, COALESCE(u.name, 'System') as authorName FROM entries e JOIN entry_versions v ON v.entry_id=e.id AND v.version=e.current_version LEFT JOIN users u ON u.id=e.author_id WHERE e.patient_id=? " + (internal ? "" : "AND e.visibility='patient' ") + "ORDER BY e.created_at DESC", [id]);
  const entries = rawEntries.map((entry) => ({ ...entry, authorRole: entry.author_role, createdAt: entry.created_at, currentVersion: entry.current_version, provenancePointer: entry.provenance_pointer }));
  const highlights = internal ? rows("SELECT h.*, c.entry_id as entryId, c.version_id as versionId, c.span_start as spanStart, c.span_end as spanEnd, c.state as evidenceState FROM highlights h JOIN evidence_claims c ON c.id=h.claim_id WHERE h.status != 'rejected' ORDER BY h.importance DESC") : [];
  const rawTasks = internal ? rows<any>("SELECT t.*, u.name as assigneeName FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.patient_id=? AND t.status='open' ORDER BY t.review_required DESC, t.due_at", [id]) : [];
  const tasks = rawTasks.map((task) => ({ ...task, assigneeId: task.assignee_id, dueAt: task.due_at, reviewRequired: Boolean(task.review_required) }));
  return NextResponse.json({ patient, user, entries, highlights, tasks, measuredWarmPath: "index-backed active highlights + open tasks" });
}
