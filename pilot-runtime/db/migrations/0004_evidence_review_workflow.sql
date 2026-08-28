-- Evidence Workbench review workflow. Run after 0003.
BEGIN;
SET LOCAL ROLE nightingale_owner;

ALTER TABLE highlights ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE highlights ADD COLUMN reviewed_at timestamptz;
ALTER TABLE highlights ADD COLUMN dismissal_reason text;
ALTER TABLE highlights ADD CONSTRAINT dismissed_highlights_require_reason CHECK (status <> 'dismissed' OR dismissal_reason IS NOT NULL);
ALTER TABLE highlights ADD CONSTRAINT highlight_dismissal_reason_known CHECK (
  dismissal_reason IS NULL OR dismissal_reason IN ('not_clinically_relevant', 'source_outdated', 'rule_false_positive')
);

CREATE FUNCTION review_highlight(target_highlight uuid, decision text, review_dismissal_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE locked_highlight highlights;
BEGIN
  SELECT * INTO locked_highlight FROM highlights WHERE id = target_highlight FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(locked_highlight.clinic_id) THEN
    RAISE EXCEPTION 'highlight not found';
  END IF;
  IF current_clinic_role(locked_highlight.clinic_id) <> 'clinician' THEN
    RAISE EXCEPTION 'only a clinician may review a highlight';
  END IF;
  IF decision NOT IN ('accepted', 'rejected', 'dismissed', 'pinned') THEN
    RAISE EXCEPTION 'invalid highlight decision';
  END IF;
  IF decision = 'dismissed' AND (review_dismissal_reason IS NULL OR review_dismissal_reason NOT IN ('not_clinically_relevant', 'source_outdated', 'rule_false_positive')) THEN
    RAISE EXCEPTION 'dismissal reason required';
  END IF;
  IF decision <> 'dismissed' AND review_dismissal_reason IS NOT NULL THEN
    RAISE EXCEPTION 'dismissal reason applies only to dismissed highlights';
  END IF;

  UPDATE highlights
  SET status = decision, reviewed_by = app_actor_id(), reviewed_at = now(), dismissal_reason = review_dismissal_reason
  WHERE id = locked_highlight.id;
  IF decision = 'accepted' THEN
    UPDATE evidence_claims SET evidence_state = 'clinician-confirmed' WHERE id = locked_highlight.claim_id;
  END IF;

  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata)
  VALUES (locked_highlight.clinic_id, app_actor_id(), 'highlight_reviewed', 'highlight', locked_highlight.id, jsonb_build_object('decision', decision, 'dismissal_reason', review_dismissal_reason));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload)
  VALUES (locked_highlight.clinic_id, 'highlight', locked_highlight.id, 'highlight_reviewed', jsonb_build_object('highlight_id', locked_highlight.id, 'decision', decision));
  RETURN locked_highlight.id;
END;
$$;

REVOKE ALL ON FUNCTION review_highlight(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_highlight(uuid, text, text) TO nightingale_web;

RESET ROLE;
COMMIT;
