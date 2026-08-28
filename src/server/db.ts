import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const sqlite = new Database(path.join(dataDir, "nightingale.db"));
sqlite.pragma("busy_timeout = 5000");
export const db = drizzle(sqlite);

export function initDb() {
  db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, display_name TEXT NOT NULL, dob TEXT NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, author_id TEXT NOT NULL, author_role TEXT NOT NULL, type TEXT NOT NULL, visibility TEXT NOT NULL, created_at TEXT NOT NULL, current_version INTEGER NOT NULL, provenance_pointer TEXT)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS entry_versions (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS evidence_claims (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, version_id TEXT NOT NULL, span_start INTEGER NOT NULL, span_end INTEGER NOT NULL, entity TEXT NOT NULL, normalized_value TEXT NOT NULL, state TEXT NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS highlights (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, title TEXT NOT NULL, risk_reason TEXT NOT NULL, importance INTEGER NOT NULL, status TEXT NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, assignee_id TEXT, due_at TEXT, review_required INTEGER NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, author_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, assignee_id TEXT, created_at TEXT NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS importance_feedback (id TEXT PRIMARY KEY, highlight_id TEXT NOT NULL, entity TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL)`);
}

export function rows<T>(query: string, params: unknown[] = []): T[] {
  return sqlite.prepare(query).all(...params) as T[];
}
export function row<T>(query: string, params: unknown[] = []): T | undefined {
  return sqlite.prepare(query).get(...params) as T | undefined;
}
export function run(query: string, params: unknown[] = []) { return sqlite.prepare(query).run(...params); }
