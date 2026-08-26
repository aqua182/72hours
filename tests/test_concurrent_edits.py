def test_stale_write_is_rejected_but_different_role_section_can_change(client):
    staff, clinician = client("staff"), client("clinician")
    _, staff_data = staff.get("/api/patients/patient-ava")
    _, clinician_data = clinician.get("/api/patients/patient-ava")
    staff_entry = next(x for x in staff_data["entries"] if x["id"] == "e-staff")
    plan = next(x for x in clinician_data["entries"] if x["id"] == "e-plan")
    status, _ = staff.patch("/api/entries/e-staff", {"content": "First staff update", "expectedVersion": staff_entry["currentVersion"]})
    assert status == 200
    status, conflict = staff.patch("/api/entries/e-staff", {"content": "Stale staff update", "expectedVersion": staff_entry["currentVersion"]})
    assert status == 409 and conflict["error"] == "VERSION_CONFLICT"
    status, _ = clinician.patch("/api/entries/e-plan", {"content": "Clinical Plan: review completed.", "expectedVersion": plan["currentVersion"]})
    assert status == 200
