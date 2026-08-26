import { cookies } from "next/headers";
import { row } from "./db";

export type Role = "patient" | "staff" | "clinician" | "admin";
export type SessionUser = { id: string; clinicId: string; name: string; role: Role };

export async function session(): Promise<SessionUser | null> {
  const id = (await cookies()).get("nightingale_session")?.value;
  if (!id) return null;
  return row<SessionUser>("SELECT id, clinic_id as clinicId, name, role FROM users WHERE id = ?", [id]) ?? null;
}

export function requireRole(user: SessionUser | null, ...roles: Role[]) {
  if (!user || !roles.includes(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export function canViewInternal(user: SessionUser) { return user.role !== "patient"; }
