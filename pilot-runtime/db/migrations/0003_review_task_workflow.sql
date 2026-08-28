-- Review Task claim and clinician closure workflow. Run after 0002.
BEGIN;
SET LOCAL ROLE nightingale_owner;

ALTER TABLE care_tasks ADD COLUMN closure_reason text;
ALTER TABLE care_tasks ADD CONSTRAINT closed_tasks_require_reason CHECK (status <> 'closed' OR closure_reason IS NOT NULL);
ALTER TABLE care_tasks ADD CONSTRAINT task_closure_reason_known CHECK (
  closure_reason IS NULL OR closure_reason IN (
    'clinician_confirmed',
    'clinician_rejected',
    'not_clinically_relevant',
    'source_outdated',
    'rule_false_positive',
    'follow_up_completed'
  )
);

CREATE FUNCTION claim_review_task(target_task uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE locked_task care_tasks;
BEGIN
  SELECT * INTO locked_task FROM care_tasks WHERE id = target_task FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(locked_task.clinic_id) THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  IF locked_task.status <> 'open' THEN
    RAISE EXCEPTION 'task is not open';
  END IF;

  UPDATE care_tasks SET status = 'claimed', assignee_id = app_actor_id() WHERE id = locked_task.id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata)
  VALUES (locked_task.clinic_id, app_actor_id(), 'review_task_claimed', 'care_task', locked_task.id, '{}'::jsonb);
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload)
  VALUES (locked_task.clinic_id, 'care_task', locked_task.id, 'task_changed', jsonb_build_object('task_id', locked_task.id, 'status', 'claimed'));
  RETURN locked_task.id;
END;
$$;

CREATE FUNCTION close_review_task(target_task uuid, resolution text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE locked_task care_tasks;
BEGIN
  SELECT * INTO locked_task FROM care_tasks WHERE id = target_task FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(locked_task.clinic_id) THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  IF NOT locked_task.review_required THEN
    RAISE EXCEPTION 'task is not a review-required task';
  END IF;
  IF locked_task.status <> 'claimed' THEN
    RAISE EXCEPTION 'task must be claimed before closure';
  END IF;
  IF current_clinic_role(locked_task.clinic_id) <> 'clinician' THEN
    RAISE EXCEPTION 'only a clinician may close a review-required task';
  END IF;
  IF resolution NOT IN ('clinician_confirmed', 'clinician_rejected', 'not_clinically_relevant', 'source_outdated', 'rule_false_positive') THEN
    RAISE EXCEPTION 'invalid review closure reason';
  END IF;

  UPDATE care_tasks SET status = 'closed', closure_reason = resolution WHERE id = locked_task.id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata)
  VALUES (locked_task.clinic_id, app_actor_id(), 'review_task_closed', 'care_task', locked_task.id, jsonb_build_object('reason', resolution));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload)
  VALUES (locked_task.clinic_id, 'care_task', locked_task.id, 'task_changed', jsonb_build_object('task_id', locked_task.id, 'status', 'closed', 'reason', resolution));
  RETURN locked_task.id;
END;
$$;

REVOKE ALL ON FUNCTION claim_review_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_review_task(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_review_task(uuid), close_review_task(uuid, text) TO nightingale_web;

RESET ROLE;
COMMIT;
