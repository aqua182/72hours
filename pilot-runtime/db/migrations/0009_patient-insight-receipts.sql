-- Patient portal receipts expose only the signed-in patient's own submitted
-- text. They deliberately exclude internal discussion, clinical responses,
-- tasks, Highlights, and care-team metadata.
BEGIN;
SET LOCAL ROLE nightingale_owner;

CREATE FUNCTION get_my_patient_insights()
RETURNS TABLE (entry_id uuid, patient_id uuid, content text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.patient_id, v.content, v.changed_at
  FROM patient_portal_access access
  JOIN care_entries e
    ON e.patient_id = access.patient_id
   AND e.author_id = app_actor_id()
   AND e.author_role = 'patient'
   AND e.type = 'patient_insight'
  JOIN entry_versions v
    ON v.entry_id = e.id
   AND v.version = e.current_version
  WHERE access.user_id = app_actor_id()
  ORDER BY v.changed_at DESC, e.id DESC
$$;

REVOKE ALL ON FUNCTION get_my_patient_insights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_patient_insights() TO nightingale_web;
RESET ROLE;
COMMIT;
