from conftest import run_pilot_micro

def test_revision_history_uses_immutable_pilot_versions_and_metadata_only_audit_events():
    run_pilot_micro("revision")
