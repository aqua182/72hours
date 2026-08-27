import type { PoolClient } from "pg";
import type { PilotActor } from "./actor-transaction";

export type ReviewTaskClosureReason = "clinician_confirmed" | "clinician_rejected" | "not_clinically_relevant" | "source_outdated" | "rule_false_positive";

export async function claimReviewTask(client: PoolClient, actor: PilotActor, taskId: string) {
  const result = await client.query<{ task_id: string }>("SELECT claim_review_task($1) AS task_id", [taskId]);
  if (result.rowCount !== 1) throw new Error("task claim did not return a task");
  return { taskId: result.rows[0].task_id, clinicId: actor.clinicId };
}

export async function closeReviewTask(client: PoolClient, actor: PilotActor, taskId: string, reason: ReviewTaskClosureReason) {
  const result = await client.query<{ task_id: string }>("SELECT close_review_task($1, $2) AS task_id", [taskId, reason]);
  if (result.rowCount !== 1) throw new Error("task closure did not return a task");
  return { taskId: result.rows[0].task_id, clinicId: actor.clinicId, reason };
}
