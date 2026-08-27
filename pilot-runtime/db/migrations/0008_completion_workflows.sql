-- Complete the auditable Pilot workflows without granting the web role direct writes.
-- PostgreSQL makes a newly added enum value usable only after its transaction
-- commits, so these two commands intentionally run before the migration body.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'patient';
ALTER TYPE entry_type ADD VALUE IF NOT EXISTS 'patient_insight';

BEGIN;
SET LOCAL ROLE nightingale_owner;

CREATE OR REPLACE FUNCTION publish_patient_summary(target_patient uuid, summary_title text, summary_content text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE patient_record patients; summary_id uuid; BEGIN
  SELECT * INTO patient_record FROM patients WHERE id = target_patient FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(patient_record.clinic_id) THEN RAISE EXCEPTION 'patient not found'; END IF;
  IF current_clinic_role(patient_record.clinic_id) NOT IN ('clinician', 'admin') THEN RAISE EXCEPTION 'only clinician may publish patient summary'; END IF;
  IF length(trim(summary_title)) = 0 OR length(trim(summary_content)) = 0 THEN RAISE EXCEPTION 'summary title and content required'; END IF;
  INSERT INTO patient_summaries (clinic_id, patient_id, title, content, authored_by) VALUES (patient_record.clinic_id, patient_record.id, trim(summary_title), trim(summary_content), app_actor_id()) ON CONFLICT (clinic_id, patient_id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, authored_by = EXCLUDED.authored_by, updated_at = now() RETURNING id INTO summary_id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (patient_record.clinic_id, app_actor_id(), 'patient_summary_published', 'patient_summary', summary_id, '{}'::jsonb);
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (patient_record.clinic_id, 'patient_summary', summary_id, 'entry_version_appended', jsonb_build_object('patient_id', patient_record.id, 'kind', 'patient_summary_published'));
  RETURN summary_id;
END; $$;

CREATE OR REPLACE FUNCTION create_patient_insight(target_patient uuid, insight_content text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE patient_record patients; entry_id uuid; version_id uuid; BEGIN
  SELECT * INTO patient_record FROM patients WHERE id = target_patient FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM patient_portal_access WHERE patient_id = target_patient AND user_id = app_actor_id()) THEN RAISE EXCEPTION 'patient portal access required'; END IF;
  IF length(trim(insight_content)) = 0 THEN RAISE EXCEPTION 'content required'; END IF;
  INSERT INTO care_entries (clinic_id, patient_id, author_id, author_role, type, visibility, provenance_pointer) VALUES (patient_record.clinic_id, patient_record.id, app_actor_id(), 'patient', 'patient_insight', 'internal', 'patient-portal:' || target_patient::text) RETURNING id INTO entry_id;
  INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by) VALUES (patient_record.clinic_id, entry_id, 1, trim(insight_content), app_actor_id()) RETURNING id INTO version_id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (patient_record.clinic_id, app_actor_id(), 'patient_insight_created', 'care_entry', entry_id, jsonb_build_object('version_id', version_id));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (patient_record.clinic_id, 'care_entry', entry_id, 'entry_version_appended', jsonb_build_object('entry_id', entry_id, 'version_id', version_id, 'kind', 'patient_insight_created'));
  RETURN entry_id;
END; $$;

CREATE OR REPLACE FUNCTION mark_evidence_claim_conflicted(target_claim uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claim evidence_claims; BEGIN
  SELECT * INTO claim FROM evidence_claims WHERE id = target_claim FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(claim.clinic_id) THEN RAISE EXCEPTION 'claim not found'; END IF;
  IF current_clinic_role(claim.clinic_id) NOT IN ('clinician', 'admin') THEN RAISE EXCEPTION 'only clinician may mark a conflict'; END IF;
  UPDATE evidence_claims SET evidence_state = 'conflicted' WHERE id = claim.id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (claim.clinic_id, app_actor_id(), 'evidence_claim_conflicted', 'evidence_claim', claim.id, '{}'::jsonb);
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (claim.clinic_id, 'evidence_claim', claim.id, 'highlight_reviewed', jsonb_build_object('claim_id', claim.id, 'kind', 'clinician_marked_conflict'));
  RETURN claim.id;
END; $$;

CREATE FUNCTION list_clinic_collaborators(target_clinic uuid) RETURNS TABLE (user_id uuid, display_name text, role user_role) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_active_clinic_member(target_clinic) THEN RAISE EXCEPTION 'forbidden clinic membership'; END IF;
  RETURN QUERY SELECT u.id, u.display_name, m.role FROM clinic_memberships m JOIN users u ON u.id = m.user_id WHERE m.clinic_id = target_clinic AND m.active ORDER BY u.display_name;
END; $$;

CREATE OR REPLACE FUNCTION create_ai_scribed_entry(target_patient uuid, requested_type entry_type, redacted_text text)
RETURNS TABLE (care_entry_id uuid, entry_version_id uuid, provenance_pointer text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE patient_record patients; system_actor uuid; source_id uuid; entry_id uuid; version_id uuid; claim_id uuid; summary_text text; BEGIN
  SELECT * INTO patient_record FROM patients WHERE id = target_patient FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(patient_record.clinic_id) THEN RAISE EXCEPTION 'patient not found'; END IF;
  IF current_clinic_role(patient_record.clinic_id) NOT IN ('staff', 'clinician', 'admin') THEN RAISE EXCEPTION 'role may not create AI entry'; END IF;
  IF requested_type NOT IN ('ai_doctor_consult_summary', 'ai_nurse_consult_summary', 'ai_patient_session_summary') THEN RAISE EXCEPTION 'invalid AI interaction type'; END IF;
  IF length(trim(redacted_text)) = 0 THEN RAISE EXCEPTION 'redacted source required'; END IF;
  summary_text := 'AI-scribed draft — clinician review required: ' || trim(redacted_text);
  INSERT INTO users (id, external_subject, display_name) VALUES (gen_random_uuid(), 'nightingale:system-scribe', 'Nightingale governed AI scribe') ON CONFLICT (external_subject) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id INTO system_actor;
  INSERT INTO ai_scribed_sources (clinic_id, patient_id, interaction_type, redacted_source, created_by) VALUES (patient_record.clinic_id, patient_record.id, requested_type, trim(redacted_text), app_actor_id()) RETURNING id INTO source_id;
  INSERT INTO care_entries (clinic_id, patient_id, author_id, author_role, type, visibility, provenance_pointer) VALUES (patient_record.clinic_id, patient_record.id, system_actor, 'system', requested_type, 'internal', 'ai-source:' || source_id::text) RETURNING id INTO entry_id;
  INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by) VALUES (patient_record.clinic_id, entry_id, 1, summary_text, app_actor_id()) RETURNING id INTO version_id;
  INSERT INTO evidence_claims (clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version) VALUES (patient_record.clinic_id, version_id, 0, length(summary_text), 'ai_scribed_draft', requested_type::text, 'source-linked', 'ai-intake-v2') RETURNING id INTO claim_id;
  INSERT INTO highlights (clinic_id, claim_id, title, risk_reason, importance, status, rule_version) VALUES (patient_record.clinic_id, claim_id, 'Review new AI-scribed note', 'A newly generated system draft requires clinician review before it can influence clinical decisions.', 58, 'suggested', 'ai-intake-v2');
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (patient_record.clinic_id, app_actor_id(), 'ai_scribed_entry_created', 'care_entry', entry_id, jsonb_build_object('source_id', source_id, 'type', requested_type, 'claim_id', claim_id));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (patient_record.clinic_id, 'care_entry', entry_id, 'entry_version_appended', jsonb_build_object('entry_id', entry_id, 'version_id', version_id, 'kind', 'ai_scribed_entry_created'));
  RETURN QUERY SELECT entry_id, version_id, 'ai-source:' || source_id::text;
END; $$;

CREATE FUNCTION create_ai_scribed_entry(target_patient uuid, requested_type entry_type, redacted_source text, scribed_summary text)
RETURNS TABLE (care_entry_id uuid, entry_version_id uuid, provenance_pointer text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE patient_record patients; system_actor uuid; source_id uuid; entry_id uuid; version_id uuid; claim_id uuid; BEGIN
  SELECT * INTO patient_record FROM patients WHERE id = target_patient FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(patient_record.clinic_id) THEN RAISE EXCEPTION 'patient not found'; END IF;
  IF current_clinic_role(patient_record.clinic_id) NOT IN ('staff', 'clinician', 'admin') THEN RAISE EXCEPTION 'role may not create AI entry'; END IF;
  IF requested_type NOT IN ('ai_doctor_consult_summary', 'ai_nurse_consult_summary', 'ai_patient_session_summary') THEN RAISE EXCEPTION 'invalid AI interaction type'; END IF;
  IF length(trim(redacted_source)) = 0 OR length(trim(scribed_summary)) = 0 THEN RAISE EXCEPTION 'redacted source and summary required'; END IF;
  INSERT INTO users (id, external_subject, display_name) VALUES (gen_random_uuid(), 'nightingale:system-scribe', 'Nightingale governed AI scribe') ON CONFLICT (external_subject) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id INTO system_actor;
  INSERT INTO ai_scribed_sources (clinic_id, patient_id, interaction_type, redacted_source, created_by) VALUES (patient_record.clinic_id, patient_record.id, requested_type, trim(redacted_source), app_actor_id()) RETURNING id INTO source_id;
  INSERT INTO care_entries (clinic_id, patient_id, author_id, author_role, type, visibility, provenance_pointer) VALUES (patient_record.clinic_id, patient_record.id, system_actor, 'system', requested_type, 'internal', 'ai-source:' || source_id::text) RETURNING id INTO entry_id;
  INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by) VALUES (patient_record.clinic_id, entry_id, 1, 'AI-scribed draft — clinician review required: ' || trim(scribed_summary), app_actor_id()) RETURNING id INTO version_id;
  INSERT INTO evidence_claims (clinic_id, entry_version_id, span_start, span_end, entity_type, normalized_value, evidence_state, extraction_config_version) VALUES (patient_record.clinic_id, version_id, 0, length('AI-scribed draft — clinician review required: ' || trim(scribed_summary)), 'ai_scribed_draft', requested_type::text, 'source-linked', 'ai-intake-v2') RETURNING id INTO claim_id;
  INSERT INTO highlights (clinic_id, claim_id, title, risk_reason, importance, status, rule_version) VALUES (patient_record.clinic_id, claim_id, 'Review new AI-scribed note', 'A newly generated system draft requires clinician review before it can influence clinical decisions.', 58, 'suggested', 'ai-intake-v2');
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata) VALUES (patient_record.clinic_id, app_actor_id(), 'ai_scribed_entry_created', 'care_entry', entry_id, jsonb_build_object('source_id', source_id, 'type', requested_type, 'claim_id', claim_id));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload) VALUES (patient_record.clinic_id, 'care_entry', entry_id, 'entry_version_appended', jsonb_build_object('entry_id', entry_id, 'version_id', version_id, 'kind', 'ai_scribed_entry_created'));
  RETURN QUERY SELECT entry_id, version_id, 'ai-source:' || source_id::text;
END; $$;

REVOKE ALL ON FUNCTION create_patient_insight(uuid, text), mark_evidence_claim_conflicted(uuid), list_clinic_collaborators(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_ai_scribed_entry(uuid, entry_type, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_patient_insight(uuid, text), mark_evidence_claim_conflicted(uuid), list_clinic_collaborators(uuid), create_ai_scribed_entry(uuid, entry_type, text, text) TO nightingale_web;
RESET ROLE;
COMMIT;
