-- Nightingale Pilot Runtime Foundation
-- Execute with a migration role. The web role must not own these tables or BYPASSRLS.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET LOCAL ROLE nightingale_owner;

CREATE TYPE user_role AS ENUM ('staff', 'clinician', 'admin');
CREATE TYPE entry_type AS ENUM ('staff_note', 'clinician_note', 'ai_doctor_consult_summary', 'ai_nurse_consult_summary', 'ai_patient_session_summary', 'instruction', 'fhir_snapshot');
CREATE TYPE entry_visibility AS ENUM ('internal', 'patient');
CREATE TYPE event_type AS ENUM ('entry_version_appended', 'task_changed', 'highlight_reviewed', 'sync_status_changed');

CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  external_subject text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinic_memberships (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role user_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, user_id)
);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  external_reference text NOT NULL,
  display_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, external_reference)
);

CREATE TABLE care_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_role user_role NOT NULL,
  type entry_type NOT NULL,
  visibility entry_visibility NOT NULL DEFAULT 'internal',
  provenance_pointer text,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'fhir_snapshot') = (provenance_pointer IS NOT NULL))
);

CREATE TABLE entry_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL REFERENCES care_entries(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  content text NOT NULL CHECK (length(content) > 0),
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, version)
);

CREATE TABLE evidence_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  entry_version_id uuid NOT NULL REFERENCES entry_versions(id) ON DELETE RESTRICT,
  span_start integer NOT NULL CHECK (span_start >= 0),
  span_end integer NOT NULL CHECK (span_end > span_start),
  entity_type text NOT NULL,
  normalized_value text NOT NULL,
  evidence_state text NOT NULL CHECK (evidence_state IN ('unverified', 'source-linked', 'clinician-confirmed', 'conflicted')),
  extraction_config_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL REFERENCES evidence_claims(id) ON DELETE RESTRICT,
  title text NOT NULL,
  risk_reason text NOT NULL,
  importance smallint NOT NULL CHECK (importance BETWEEN 0 AND 100),
  status text NOT NULL CHECK (status IN ('suggested', 'accepted', 'rejected', 'dismissed', 'pinned')),
  rule_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE care_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'claimed', 'closed', 'cancelled')),
  assignee_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  due_at timestamptz,
  review_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'claimed' OR assignee_id IS NOT NULL)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (metadata ? 'content'))
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  type event_type NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX care_entries_clinic_patient_created_idx ON care_entries (clinic_id, patient_id, created_at DESC);
CREATE INDEX entry_versions_clinic_entry_idx ON entry_versions (clinic_id, entry_id, version DESC);
CREATE INDEX highlights_clinic_status_importance_idx ON highlights (clinic_id, status, importance DESC);
CREATE INDEX care_tasks_clinic_status_due_idx ON care_tasks (clinic_id, status, due_at);
CREATE INDEX outbox_undelivered_idx ON outbox_events (created_at) WHERE delivered_at IS NULL;

-- Identity is supplied only by verified middleware in the same database transaction.
CREATE FUNCTION app_actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- The web service may call this only after verifying the OIDC token's issuer,
-- audience, expiry, and subject. It scopes the setting to the current transaction.
CREATE FUNCTION establish_authenticated_actor(verified_subject text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid;
BEGIN
  SELECT id INTO actor FROM users WHERE external_subject = verified_subject;
  IF NOT FOUND THEN RAISE EXCEPTION 'authenticated subject is not provisioned'; END IF;
  PERFORM set_config('app.user_id', actor::text, true);
  RETURN actor;
END;
$$;

CREATE FUNCTION is_active_clinic_member(target_clinic uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM clinic_memberships
    WHERE clinic_id = target_clinic AND user_id = app_actor_id() AND active
  )
$$;

CREATE FUNCTION current_clinic_role(target_clinic uuid) RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM clinic_memberships
  WHERE clinic_id = target_clinic AND user_id = app_actor_id() AND active
$$;

CREATE FUNCTION append_entry_version(target_entry uuid, expected_version integer, next_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  locked_entry care_entries;
  next_version integer;
  version_id uuid;
BEGIN
  SELECT * INTO locked_entry FROM care_entries WHERE id = target_entry FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(locked_entry.clinic_id) THEN RAISE EXCEPTION 'entry not found'; END IF;
  IF locked_entry.author_role <> current_clinic_role(locked_entry.clinic_id) THEN RAISE EXCEPTION 'role cannot edit this entry'; END IF;
  IF locked_entry.current_version <> expected_version THEN RAISE EXCEPTION 'version conflict'; END IF;
  IF length(trim(next_content)) = 0 THEN RAISE EXCEPTION 'content required'; END IF;

  next_version := expected_version + 1;
  INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by)
  VALUES (locked_entry.clinic_id, locked_entry.id, next_version, next_content, app_actor_id())
  RETURNING id INTO version_id;
  UPDATE care_entries SET current_version = next_version WHERE id = locked_entry.id;
  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata)
  VALUES (locked_entry.clinic_id, app_actor_id(), 'entry_version_appended', 'care_entry', locked_entry.id, jsonb_build_object('from', expected_version, 'to', next_version));
  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload)
  VALUES (locked_entry.clinic_id, 'care_entry', locked_entry.id, 'entry_version_appended', jsonb_build_object('entry_id', locked_entry.id, 'version_id', version_id));
  RETURN version_id;
END;
$$;

CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit events are immutable'; END;
$$;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE clinics FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE clinic_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
ALTER TABLE care_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE entry_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE highlights FORCE ROW LEVEL SECURITY;
ALTER TABLE care_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_self ON clinic_memberships FOR SELECT USING (user_id = app_actor_id() AND active);
CREATE POLICY users_self ON users FOR SELECT USING (id = app_actor_id());
CREATE POLICY clinics_member ON clinics FOR SELECT USING (is_active_clinic_member(id));

CREATE POLICY patients_member ON patients FOR ALL USING (is_active_clinic_member(clinic_id)) WITH CHECK (is_active_clinic_member(clinic_id));
CREATE POLICY entries_member ON care_entries FOR ALL USING (is_active_clinic_member(clinic_id)) WITH CHECK (is_active_clinic_member(clinic_id));
CREATE POLICY versions_member ON entry_versions FOR ALL USING (is_active_clinic_member(clinic_id)) WITH CHECK (is_active_clinic_member(clinic_id));
CREATE POLICY claims_member ON evidence_claims FOR ALL USING (is_active_clinic_member(clinic_id)) WITH CHECK (is_active_clinic_member(clinic_id));
CREATE POLICY highlights_member ON highlights FOR ALL USING (is_active_clinic_member(clinic_id)) WITH CHECK (is_active_clinic_member(clinic_id));
CREATE POLICY tasks_member ON care_tasks FOR ALL USING (is_active_clinic_member(clinic_id)) WITH CHECK (is_active_clinic_member(clinic_id));
CREATE POLICY audit_member ON audit_events FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY outbox_member ON outbox_events FOR SELECT USING (is_active_clinic_member(clinic_id));

-- The application role reads only through RLS and mutates only through vetted
-- security-definer functions. The owner bypasses RLS inside those functions,
-- which is necessary to append immutable audit/outbox records atomically.
ALTER TABLE clinics NO FORCE ROW LEVEL SECURITY;
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinic_memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE patients NO FORCE ROW LEVEL SECURITY;
ALTER TABLE care_entries NO FORCE ROW LEVEL SECURITY;
ALTER TABLE entry_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_claims NO FORCE ROW LEVEL SECURITY;
ALTER TABLE highlights NO FORCE ROW LEVEL SECURITY;
ALTER TABLE care_tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events NO FORCE ROW LEVEL SECURITY;

DROP POLICY patients_member ON patients;
DROP POLICY entries_member ON care_entries;
DROP POLICY versions_member ON entry_versions;
DROP POLICY claims_member ON evidence_claims;
DROP POLICY highlights_member ON highlights;
DROP POLICY tasks_member ON care_tasks;
DROP POLICY audit_member ON audit_events;
DROP POLICY outbox_member ON outbox_events;

CREATE POLICY patients_read_member ON patients FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY entries_read_member ON care_entries FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY versions_read_member ON entry_versions FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY claims_read_member ON evidence_claims FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY highlights_read_member ON highlights FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY tasks_read_member ON care_tasks FOR SELECT USING (is_active_clinic_member(clinic_id));
CREATE POLICY audit_read_admin ON audit_events FOR SELECT USING (current_clinic_role(clinic_id) = 'admin');

-- Child records cannot silently point into another clinic's data graph.
ALTER TABLE patients ADD CONSTRAINT patients_clinic_id_id_unique UNIQUE (clinic_id, id);
ALTER TABLE care_entries ADD CONSTRAINT care_entries_clinic_id_id_unique UNIQUE (clinic_id, id);
ALTER TABLE entry_versions ADD CONSTRAINT entry_versions_clinic_id_id_unique UNIQUE (clinic_id, id);
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_clinic_id_id_unique UNIQUE (clinic_id, id);
ALTER TABLE care_entries ADD CONSTRAINT care_entries_same_clinic_patient FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id);
ALTER TABLE entry_versions ADD CONSTRAINT entry_versions_same_clinic_entry FOREIGN KEY (clinic_id, entry_id) REFERENCES care_entries (clinic_id, id);
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_same_clinic_version FOREIGN KEY (clinic_id, entry_version_id) REFERENCES entry_versions (clinic_id, id);
ALTER TABLE highlights ADD CONSTRAINT highlights_same_clinic_claim FOREIGN KEY (clinic_id, claim_id) REFERENCES evidence_claims (clinic_id, id);
ALTER TABLE care_tasks ADD CONSTRAINT tasks_same_clinic_patient FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id);

CREATE FUNCTION validate_claim_span() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source_length integer;
BEGIN
  SELECT length(v.content) INTO source_length FROM entry_versions v WHERE v.id = NEW.entry_version_id AND v.clinic_id = NEW.clinic_id;
  IF source_length IS NULL OR NEW.span_end > source_length THEN RAISE EXCEPTION 'claim span exceeds immutable source version'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_claim_span_valid BEFORE INSERT OR UPDATE ON evidence_claims FOR EACH ROW EXECUTE FUNCTION validate_claim_span();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, nightingale_web, nightingale_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, nightingale_web, nightingale_worker;
GRANT USAGE ON SCHEMA public TO nightingale_web, nightingale_worker;
GRANT SELECT ON clinics, users, clinic_memberships, patients, care_entries, entry_versions, evidence_claims, highlights, care_tasks, audit_events TO nightingale_web;
GRANT EXECUTE ON FUNCTION establish_authenticated_actor(text), append_entry_version(uuid, integer, text) TO nightingale_web;

RESET ROLE;

COMMIT;
