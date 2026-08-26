def test_pinning_a_highlight_increases_similar_future_suggestion_priority(client):
    clinician = client("clinician")
    _, before = clinician.get("/api/patients/patient-ava")
    similar_before = next(h for h in before["highlights"] if h["id"] == "h-rash-context")["importance"]
    status, _ = clinician.post("/api/highlights/h-rash", {"action": "pinned"})
    assert status == 200
    _, after = clinician.get("/api/patients/patient-ava")
    similar_after = next(h for h in after["highlights"] if h["id"] == "h-rash-context")["importance"]
    assert similar_after > similar_before
