import "@/server/bootstrap";
import { NextResponse } from "next/server";
import { row } from "@/server/db";

const roleUser: Record<string, string> = { patient: "u-patient", staff: "u-staff", clinician: "u-clinician", admin: "u-admin" };

export async function POST(request: Request) {
  const { role } = await request.json();
  const id = roleUser[role];
  if (!id || !row("SELECT id FROM users WHERE id = ?", [id])) return NextResponse.json({ error: "invalid role" }, { status: 400 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("nightingale_session", id, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}
