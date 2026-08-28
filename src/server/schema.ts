import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
});

export const entries = sqliteTable("entries", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull(),
  authorId: text("author_id").notNull(),
  authorRole: text("author_role").notNull(),
  type: text("type").notNull(),
  visibility: text("visibility").notNull(),
  createdAt: text("created_at").notNull(),
  currentVersion: integer("current_version").notNull(),
  provenancePointer: text("provenance_pointer"),
});

export const entryVersions = sqliteTable("entry_versions", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull(),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  changedBy: text("changed_by").notNull(),
  changedAt: text("changed_at").notNull(),
});

export const evidenceClaims = sqliteTable("evidence_claims", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull(),
  versionId: text("version_id").notNull(),
  spanStart: integer("span_start").notNull(),
  spanEnd: integer("span_end").notNull(),
  entity: text("entity").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  state: text("state").notNull(),
});

export const highlights = sqliteTable("highlights", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").notNull(),
  title: text("title").notNull(),
  riskReason: text("risk_reason").notNull(),
  importance: integer("importance").notNull(),
  status: text("status").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull(),
  sourceId: text("source_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  assigneeId: text("assignee_id"),
  dueAt: text("due_at"),
  reviewRequired: integer("review_required").notNull(),
});
