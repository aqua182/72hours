import type { PoolClient } from "pg";
import type { PilotActor } from "./actor-transaction";

export type HighlightDecision = "accepted" | "rejected" | "dismissed" | "pinned";
export type DismissalReason = "not_clinically_relevant" | "source_outdated" | "rule_false_positive";

export type EvidenceWorkbench = {
  highlightId: string;
  title: string;
  riskReason: string;
  importance: number;
  highlightStatus: string;
  ruleVersion: string;
  evidenceState: string;
  entityType: string;
  normalizedValue: string;
  extractionConfigVersion: string;
  sourceEntryId: string;
  sourceEntryVersionId: string;
  spanStart: number;
  spanEnd: number;
  sourceExcerpt: string;
};

export async function getEvidenceWorkbench(client: PoolClient, actor: PilotActor, highlightId: string): Promise<EvidenceWorkbench> {
  const result = await client.query<{
    highlight_id: string; title: string; risk_reason: string; importance: number; highlight_status: string; rule_version: string;
    evidence_state: string; entity_type: string; normalized_value: string; extraction_config_version: string;
    source_entry_id: string; source_entry_version_id: string; span_start: number; span_end: number; source_excerpt: string;
  }>(
    `SELECT
       h.id AS highlight_id, h.title, h.risk_reason, h.importance, h.status AS highlight_status, h.rule_version,
       c.evidence_state, c.entity_type, c.normalized_value, c.extraction_config_version,
       v.entry_id AS source_entry_id, v.id AS source_entry_version_id, c.span_start, c.span_end,
       substring(v.content FROM c.span_start + 1 FOR c.span_end - c.span_start) AS source_excerpt
     FROM highlights h
     JOIN evidence_claims c ON c.id = h.claim_id
     JOIN entry_versions v ON v.id = c.entry_version_id
     WHERE h.id = $1 AND h.clinic_id = $2`,
    [highlightId, actor.clinicId],
  );
  if (result.rowCount !== 1) throw new Error("highlight not found");
  const row = result.rows[0];
  return {
    highlightId: row.highlight_id,
    title: row.title,
    riskReason: row.risk_reason,
    importance: row.importance,
    highlightStatus: row.highlight_status,
    ruleVersion: row.rule_version,
    evidenceState: row.evidence_state,
    entityType: row.entity_type,
    normalizedValue: row.normalized_value,
    extractionConfigVersion: row.extraction_config_version,
    sourceEntryId: row.source_entry_id,
    sourceEntryVersionId: row.source_entry_version_id,
    spanStart: row.span_start,
    spanEnd: row.span_end,
    sourceExcerpt: row.source_excerpt,
  };
}

export async function reviewHighlight(client: PoolClient, actor: PilotActor, highlightId: string, decision: HighlightDecision, dismissalReason?: DismissalReason) {
  const result = await client.query<{ highlight_id: string }>("SELECT review_highlight($1, $2, $3) AS highlight_id", [highlightId, decision, dismissalReason ?? null]);
  if (result.rowCount !== 1) throw new Error("highlight review did not return a highlight");
  return { highlightId: result.rows[0].highlight_id, clinicId: actor.clinicId, decision };
}
