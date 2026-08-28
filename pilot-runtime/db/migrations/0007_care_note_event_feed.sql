-- Browser subscriptions must not receive direct outbox-table access. This
-- narrow capability returns only a timestamp after clinic/patient validation.
BEGIN;
SET LOCAL ROLE nightingale_owner;
CREATE FUNCTION care_note_changed_after(target_patient uuid, after_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target patients; changed_at timestamptz;
BEGIN
  SELECT * INTO target FROM patients WHERE id = target_patient;
  IF NOT FOUND OR NOT is_active_clinic_member(target.clinic_id) THEN RAISE EXCEPTION 'patient not found'; END IF;
  SELECT max(o.created_at) INTO changed_at FROM outbox_events o
  WHERE o.clinic_id = target.clinic_id AND o.created_at > after_at AND (
    o.payload ->> 'entry_id' IN (SELECT id::text FROM care_entries WHERE patient_id = target.id AND clinic_id = target.clinic_id)
    OR o.aggregate_id IN (SELECT id FROM care_tasks WHERE patient_id = target.id AND clinic_id = target.clinic_id)
    OR o.aggregate_id IN (
      SELECT h.id FROM highlights h JOIN evidence_claims c ON c.id = h.claim_id JOIN entry_versions v ON v.id = c.entry_version_id JOIN care_entries e ON e.id = v.entry_id
      WHERE e.patient_id = target.id AND h.clinic_id = target.clinic_id
    )
  );
  RETURN changed_at;
END;
$$;
REVOKE ALL ON FUNCTION care_note_changed_after(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION care_note_changed_after(uuid, timestamptz) TO nightingale_web;
RESET ROLE;
COMMIT;
