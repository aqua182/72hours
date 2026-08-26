def test_edit_increments_and_revert_creates_auditable_new_version(client):
    staff = client("staff")
    _, data = staff.get("/api/patients/patient-ava")
    entry = next(x for x in data["entries"] if x["id"] == "e-staff")
    original_version = entry["currentVersion"]
    status, changed = staff.patch("/api/entries/e-staff", {"content": "Lab order remains unbooked. Review requested.", "expectedVersion": original_version})
    assert status == 200 and changed["version"] == original_version + 1
    status, reverted = staff.post("/api/entries/e-staff/revert", {"version": original_version})
    assert status == 200 and reverted["version"] == original_version + 2
    status, audit = client("admin").get("/api/audit/e-staff")
    assert status == 200
    assert any(event["action"] == "edited_entry" for event in audit["events"])
    assert all("content" not in event["metadata"] for event in audit["events"])
