-- First authenticated Care Note mutation. Run after 0001_foundation.sql.
BEGIN;
SET LOCAL ROLE nightingale_owner;

CREATE FUNCTION create_care_entry(
  target_patient uuid,
  requested_type entry_type,
  requested_visibility entry_visibility,
  initial_content text,
  requested_provenance_pointer text DEFAULT NULL
)
RETURNS TABLE (care_entry_id uuid, entry_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  patient_record patients;
  acting_role user_role;
  created_entry_id uuid;
  created_version_id uuid;
BEGIN
  SELECT * INTO patient_record FROM patients WHERE id = target_patient FOR UPDATE;
  IF NOT FOUND OR NOT is_active_clinic_member(patient_record.clinic_id) THEN
    RAISE EXCEPTION 'patient not found';
  END IF;

  acting_role := current_clinic_role(patient_record.clinic_id);
  IF acting_role = 'staff' AND requested_type <> 'staff_note' THEN
    RAISE EXCEPTION 'staff may create staff notes only';
  END IF;
  IF acting_role = 'clinician' AND requested_type <> 'clinician_note' THEN
    RAISE EXCEPTION 'clinician may create clinician notes only';
  END IF;
  IF acting_role NOT IN ('staff', 'clinician') THEN
    RAISE EXCEPTION 'role may not create care entries';
  END IF;
  IF requested_visibility <> 'internal' THEN
    RAISE EXCEPTION 'patient-visible entries require the patient-summary workflow';
  END IF;
  IF requested_provenance_pointer IS NOT NULL OR requested_type = 'fhir_snapshot' THEN
    RAISE EXCEPTION 'FHIR snapshots are created by the governed import workflow';
  END IF;
  IF length(trim(initial_content)) = 0 THEN
    RAISE EXCEPTION 'content required';
  END IF;

  INSERT INTO care_entries (clinic_id, patient_id, author_id, author_role, type, visibility)
  VALUES (patient_record.clinic_id, patient_record.id, app_actor_id(), acting_role, requested_type, requested_visibility)
  RETURNING id INTO created_entry_id;

  INSERT INTO entry_versions (clinic_id, entry_id, version, content, changed_by)
  VALUES (patient_record.clinic_id, created_entry_id, 1, initial_content, app_actor_id())
  RETURNING id INTO created_version_id;

  INSERT INTO audit_events (clinic_id, actor_id, action, target_type, target_id, metadata)
  VALUES (
    patient_record.clinic_id,
    app_actor_id(),
    'care_entry_created',
    'care_entry',
    created_entry_id,
    jsonb_build_object('entry_version_id', created_version_id, 'version', 1, 'type', requested_type)
  );

  INSERT INTO outbox_events (clinic_id, aggregate_type, aggregate_id, type, payload)
  VALUES (
    patient_record.clinic_id,
    'care_entry',
    created_entry_id,
    'entry_version_appended',
    jsonb_build_object('entry_id', created_entry_id, 'version_id', created_version_id, 'version', 1)
  );

  RETURN QUERY SELECT created_entry_id, created_version_id;
END;
$$;

-- Security-definer functions are explicit application capabilities, never
-- public database APIs. Existing Foundation functions are tightened here too.
REVOKE ALL ON FUNCTION establish_authenticated_actor(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_entry_version(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_care_entry(uuid, entry_type, entry_visibility, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_care_entry(uuid, entry_type, entry_visibility, text, text) TO nightingale_web;

RESET ROLE;
COMMIT;
