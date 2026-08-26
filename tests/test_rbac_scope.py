def test_patient_cannot_read_internal_ai_or_comments(client):
    status, payload = client("patient").get("/api/patients/patient-ava")
    assert status == 200
    assert payload["highlights"] == [] and payload["tasks"] == []
    assert all(entry["visibility"] == "patient" for entry in payload["entries"])
    assert all(entry["authorRole"] != "system" for entry in payload["entries"])

def test_staff_and_clinician_cannot_overwrite_each_other(client):
    status, _ = client("staff").patch("/api/entries/e-plan", {"content": "tamper", "expectedVersion": 1})
    assert status == 403
    status, _ = client("clinician").patch("/api/entries/e-staff", {"content": "tamper", "expectedVersion": 1})
    assert status == 403
