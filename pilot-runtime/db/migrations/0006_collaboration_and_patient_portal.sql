-- Collaborative Care Note completion: comments, immutable reverts, governed
-- AI intake, patient-safe summaries, and bounded importance feedback.
BEGIN;
SET LOCAL ROLE nightingale_owner;

CREATE TABLE ai_scribed_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  interaction_type entry_type NOT NULL CHECK (interaction_type IN ('ai_doctor_consult_summary', 'ai_nurse_consult_summary', 'ai_patient_session_summary')),
  redacted_source text NOT NULL CHECK (length(redacted_source) > 0), created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (clinic_id, id),
  CONSTRAINT ai_scribed_sources_same_clinic_patient FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id)
);
CREATE TABLE entry_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, entry_id uuid NOT NULL REFERENCES care_entries(id) ON DELETE RESTRICT,
  parent_comment_id uuid REFERENCES entry_comments(id) ON DELETE RESTRICT, author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_role user_role NOT NULL, body text NOT NULL CHECK (length(trim(body)) > 0),
  mentioned_user_id uuid REFERENCES users(id) ON DELETE RESTRICT, assigned_to_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')), resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)), UNIQUE (clinic_id, id),
  CONSTRAINT comments_same_clinic_patient FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  CONSTRAINT comments_same_clinic_entry FOREIGN KEY (clinic_id, entry_id) REFERENCES care_entries (clinic_id, id)
);
CREATE TABLE importance_learning (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT, entity_type text NOT NULL,
  score smallint NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 10), interaction_count integer NOT NULL DEFAULT 0 CHECK (interaction_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (clinic_id, entity_type)
);
CREATE TABLE patient_portal_access (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (patient_id, user_id)
);
CREATE TABLE patient_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, title text NOT NULL, content text NOT NULL CHECK (length(trim(content)) > 0),
  authored_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, patient_id), CONSTRAINT patient_summaries_same_clinic_patient FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id)
);
-- Original Foundation only permitted provenance on FHIR snapshots. Governed
-- AI sources are also immutable, citable origins, so they must retain one.
ALTER TABLE care_entries DROP CONSTRAINT care_entries_check;
ALTER TABLE care_entries ADD CONSTRAINT care_entries_provenance_required_for_fhir CHECK (type <> 'fhir_snapshot' OR provenance_pointer IS NOT NULL);
CREATE INDEX entry_comments_entry_created_idx ON entry_comments (clinic_id, entry_id, created_at);
CREATE INDEX ai_scribed_sources_patient_created_idx ON ai_scribed_sources (clinic_id, patient_id, created_at DESC);

CREATE FUNCTION assert_active_member_for_entry(target_entry uuid) RETURNS care_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE locked_entry care_entries; BEGIN
  SELECT * INTO locked_entry FROM care_entries WHERE id = target_entry FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(locked_entry.clinic_id) THEN RAISE EXCEPTION 'entry not found'; END IF;
  RETURN locked_entry;
END; $$;

CREATE FUNCTION create_entry_comment(target_entry uuid, comment_body text, parent_id uuid DEFAULT NULL, mentioned_user uuid DEFAULT NULL, assigned_user uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target care_entries; comment_id uuid; actor_role user_role; BEGIN
  target := assert_active_member_for_entry(target_entry); actor_role := current_clinic_role(target.clinic_id);
  IF actor_role NOT IN ('staff', 'clinician', 'admin') THEN RAISE EXCEPTION 'role may not comment'; END IF;
  IF length(trim(comment_body)) = 0 THEN RAISE EXCEPTION 'comment required'; END IF;
  IF parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entry_comments WHERE id = parent_id AND entry_id = target.id AND clinic_id = target.clinic_id) THEN RAISE EXCEPTION 'parent comment not found'; END IF;
  IF mentioned_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clinic_memberships WHERE clinic_id = target.clinic_id AND user_id = mentioned_user AND active) THEN RAISE EXCEPTION 'mentioned user is not a clinic member'; END IF;
  IF assigned_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clinic_memberships WHERE clinic_id = target.clinic_id AND user_id = assigned_user AND active) THEN RAISE EXCEPTION 'assignee is not a clinic member'; END IF;
  INSERT INTO entry_comments (clinic_id, patient_id, entry_id, parent_comment_id, author_id, author_role, body, mentioned_user_id, assigned_to_user_id)
  VALUES (target.clinic_id, target.patient_id, target.id, parent_id, app_actor_id(), actor_role, trim(comment_body), mentioned_user, assigned_user) RETURNING id INTO comment_id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata)
  VALUES (target.clinic_id, app_actor_id(), 'comment_created', 'entry_comment', comment_id, jsonb_build_object('entry_id', target.id, 'has_mention', mentioned_user IS NOT NULL, 'has_assignment', assigned_user IS NOT NULL));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload)
  VALUES (target.clinic_id, 'entry_comment', comment_id, 'entry_version_appended', jsonb_build_object('entry_id', target.id, 'comment_id', comment_id, 'kind', 'comment_created'));
  RETURN comment_id;
END; $$;

CREATE FUNCTION set_entry_comment_resolution(target_comment uuid, should_resolve boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target entry_comments; actor_role user_role; BEGIN
  SELECT * INTO target FROM entry_comments WHERE id = target_comment FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(target.clinic_id) THEN RAISE EXCEPTION 'comment not found'; END IF;
  actor_role := current_clinic_role(target.clinic_id);
  IF app_actor_id() <> target.author_id AND actor_role NOT IN ('clinician', 'admin') THEN RAISE EXCEPTION 'role may not resolve this comment'; END IF;
  UPDATE entry_comments SET status = CASE WHEN should_resolve THEN 'resolved' ELSE 'open' END, resolved_by = CASE WHEN should_resolve THEN app_actor_id() ELSE NULL END, resolved_at = CASE WHEN should_resolve THEN now() ELSE NULL END WHERE id = target.id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (target.clinic_id, app_actor_id(), CASE WHEN should_resolve THEN 'comment_resolved' ELSE 'comment_reopened' END, 'entry_comment', target.id, '{}'::jsonb);
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (target.clinic_id, 'entry_comment', target.id, 'entry_version_appended', jsonb_build_object('entry_id', target.entry_id, 'comment_id', target.id, 'kind', CASE WHEN should_resolve THEN 'comment_resolved' ELSE 'comment_reopened' END));
  RETURN target.id;
END; $$;

CREATE FUNCTION revert_entry_to_version(target_entry uuid, source_version integer, expected_version integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE locked_entry care_entries; source_content text; version_id uuid; BEGIN
  locked_entry := assert_active_member_for_entry(target_entry);
  IF locked_entry.author_role <> current_clinic_role(locked_entry.clinic_id) THEN RAISE EXCEPTION 'role cannot edit this entry'; END IF;
  IF locked_entry.current_version <> expected_version THEN RAISE EXCEPTION 'version conflict'; END IF;
  SELECT content INTO source_content FROM entry_versions WHERE entry_id = locked_entry.id AND version = source_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'source version not found'; END IF;
  INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by) VALUES (locked_entry.clinic_id, locked_entry.id, expected_version + 1, source_content, app_actor_id()) RETURNING id INTO version_id;
  UPDATE care_entries SET current_version = expected_version + 1 WHERE id = locked_entry.id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (locked_entry.clinic_id, app_actor_id(), 'entry_reverted', 'care_entry', locked_entry.id, jsonb_build_object('from', expected_version, 'reverted_to', source_version, 'to', expected_version + 1));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (locked_entry.clinic_id, 'care_entry', locked_entry.id, 'entry_version_appended', jsonb_build_object('entry_id', locked_entry.id, 'version_id', version_id, 'reverted_to', source_version));
  RETURN version_id;
END; $$;

CREATE FUNCTION create_ai_scribed_entry(target_patient uuid, requested_type entry_type, redacted_text text)
RETURNS TABLE (care_entry_id uuid, entry_version_id uuid, provenance_pointer text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE patient_record patients; system_actor uuid; source_id uuid; entry_id uuid; version_id uuid; BEGIN
  SELECT * INTO patient_record FROM patients WHERE id = target_patient FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(patient_record.clinic_id) THEN RAISE EXCEPTION 'patient not found'; END IF;
  IF current_clinic_role(patient_record.clinic_id) NOT IN ('staff', 'clinician', 'admin') THEN RAISE EXCEPTION 'role may not create AI entry'; END IF;
  IF requested_type NOT IN ('ai_doctor_consult_summary', 'ai_nurse_consult_summary', 'ai_patient_session_summary') THEN RAISE EXCEPTION 'invalid AI interaction type'; END IF;
  IF length(trim(redacted_text)) = 0 THEN RAISE EXCEPTION 'redacted source required'; END IF;
  INSERT INTO users (id, external_subject, display_name) VALUES (gen_random_uuid(), 'nightingale:system-scribe', 'Nightingale governed AI scribe') ON CONFLICT (external_subject) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id INTO system_actor;
  INSERT INTO ai_scribed_sources (clinic_id, patient_id, interaction_type, redacted_source, created_by) VALUES (patient_record.clinic_id, patient_record.id, requested_type, trim(redacted_text), app_actor_id()) RETURNING id INTO source_id;
  INSERT INTO care_entries (clinic_id, patient_id, author_id, author_role, type, visibility, provenance_pointer) VALUES (patient_record.clinic_id, patient_record.id, system_actor, 'system', requested_type, 'internal', 'ai-source:' || source_id::text) RETURNING id INTO entry_id;
  INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by) VALUES (patient_record.clinic_id, entry_id, 1, 'AI-scribed draft — clinician review required: ' || trim(redacted_text), app_actor_id()) RETURNING id INTO version_id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (patient_record.clinic_id, app_actor_id(), 'ai_scribed_entry_created', 'care_entry', entry_id, jsonb_build_object('source_id', source_id, 'type', requested_type));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (patient_record.clinic_id, 'care_entry', entry_id, 'entry_version_appended', jsonb_build_object('entry_id', entry_id, 'version_id', version_id, 'kind', 'ai_scribed_entry_created'));
  RETURN QUERY SELECT entry_id, version_id, 'ai-source:' || source_id::text;
END; $$;

CREATE FUNCTION publish_patient_summary(target_patient uuid, summary_title text, summary_content text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE patient_record patients; summary_id uuid; BEGIN
  SELECT * INTO patient_record FROM patients WHERE id = target_patient FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(patient_record.clinic_id) THEN RAISE EXCEPTION 'patient not found'; END IF;
  IF current_clinic_role(patient_record.clinic_id) NOT IN ('clinician', 'admin') THEN RAISE EXCEPTION 'only clinician may publish patient summary'; END IF;
  IF length(trim(summary_title)) = 0 OR length(trim(summary_content)) = 0 THEN RAISE EXCEPTION 'summary title and content required'; END IF;
  INSERT INTO patient_summaries (clinic_id, patient_id, title, content, authored_by) VALUES (patient_record.clinic_id, patient_record.id, trim(summary_title), trim(summary_content), app_actor_id()) ON CONFLICT (clinic_id, patient_id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, authored_by = EXCLUDED.authored_by, updated_at = now() RETURNING id INTO summary_id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (patient_record.clinic_id, app_actor_id(), 'patient_summary_published', 'patient_summary', summary_id, '{}'::jsonb);
  RETURN summary_id;
END; $$;

CREATE FUNCTION get_my_patient_summaries() RETURNS TABLE (patient_id uuid, display_label text, title text, content text, updated_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_label, s.title, s.content, s.updated_at FROM patient_portal_access a JOIN patients p ON p.id = a.patient_id JOIN patient_summaries s ON s.patient_id = p.id AND s.clinic_id = p.clinic_id WHERE a.user_id = app_actor_id() ORDER BY s.updated_at DESC
$$;

CREATE OR REPLACE FUNCTION review_highlight(target_highlight uuid, decision text, review_dismissal_reason text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE locked_highlight highlights; learned_entity text; BEGIN
  SELECT * INTO locked_highlight FROM highlights WHERE id = target_highlight FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(locked_highlight.clinic_id) THEN RAISE EXCEPTION 'highlight not found'; END IF;
  IF current_clinic_role(locked_highlight.clinic_id) <> 'clinician' THEN RAISE EXCEPTION 'only a clinician may review a highlight'; END IF;
  IF decision NOT IN ('accepted', 'rejected', 'dismissed', 'pinned') THEN RAISE EXCEPTION 'invalid highlight decision'; END IF;
  IF decision = 'dismissed' AND (review_dismissal_reason IS NULL OR review_dismissal_reason NOT IN ('not_clinically_relevant', 'source_outdated', 'rule_false_positive')) THEN RAISE EXCEPTION 'dismissal reason required'; END IF;
  IF decision <> 'dismissed' AND review_dismissal_reason IS NOT NULL THEN RAISE EXCEPTION 'dismissal reason applies only to dismissed highlights'; END IF;
  UPDATE highlights SET status = decision, reviewed_by = app_actor_id(), reviewed_at = now(), dismissal_reason = review_dismissal_reason WHERE id = locked_highlight.id;
  IF decision = 'accepted' THEN UPDATE evidence_claims SET evidence_state = 'clinician-confirmed' WHERE id = locked_highlight.claim_id; END IF;
  IF decision IN ('accepted', 'pinned') THEN SELECT entity_type INTO learned_entity FROM evidence_claims WHERE id = locked_highlight.claim_id; INSERT INTO importance_learning (clinic_id, entity_type, score, interaction_count) VALUES (locked_highlight.clinic_id, learned_entity, 1, 1) ON CONFLICT (clinic_id, entity_type) DO UPDATE SET score = LEAST(10, importance_learning.score + 1), interaction_count = importance_learning.interaction_count + 1, updated_at = now(); END IF;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (locked_highlight.clinic_id, app_actor_id(), 'highlight_reviewed', 'highlight', locked_highlight.id, jsonb_build_object('decision', decision, 'dismissal_reason', review_dismissal_reason));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (locked_highlight.clinic_id, 'highlight', locked_highlight.id, 'highlight_reviewed', jsonb_build_object('highlight_id', locked_highlight.id, 'decision', decision));
  RETURN locked_highlight.id;
END; $$;

ALTER TABLE ai_scribed_sources ENABLE ROW LEVEL SECURITY; ALTER TABLE entry_comments ENABLE ROW LEVEL SECURITY; ALTER TABLE importance_learning ENABLE ROW LEVEL SECURITY; ALTER TABLE patient_portal_access ENABLE ROW LEVEL SECURITY; ALTER TABLE patient_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_sources_read_member ON ai_scribed_sources FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY comments_read_member ON entry_comments FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY learning_read_member ON importance_learning FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY portal_access_self ON patient_portal_access FOR SELECT USING (user_id = app_actor_id());
CREATE POLICY patient_summaries_read_member ON patient_summaries FOR SELECT USING (is_active_clinic_member(clinic_id));
REVOKE ALL ON ai_scribed_sources, entry_comments, importance_learning, patient_portal_access, patient_summaries FROM PUBLIC, nightingale_web, nightingale_worker;
GRANT SELECT ON ai_scribed_sources, entry_comments, importance_learning, patient_portal_access, patient_summaries TO nightingale_web;
REVOKE ALL ON FUNCTION create_entry_comment(uuid, text, uuid, uuid, uuid), set_entry_comment_resolution(uuid, boolean), revert_entry_to_version(uuid, integer, integer), create_ai_scribed_entry(uuid, entry_type, text), publish_patient_summary(uuid, text, text), get_my_patient_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_entry_comment(uuid, text, uuid, uuid, uuid), set_entry_comment_resolution(uuid, boolean), revert_entry_to_version(uuid, integer, integer), create_ai_scribed_entry(uuid, entry_type, text), publish_patient_summary(uuid, text, text), get_my_patient_summaries() TO nightingale_web;
RESET ROLE;
COMMIT;
