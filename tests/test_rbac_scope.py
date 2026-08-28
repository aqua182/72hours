from conftest import run_pilot_micro

def test_staff_clinician_and_patient_scopes_are_enforced_by_pilot_postgres():
    run_pilot_micro("rbac")
