def test_every_highlight_resolves_to_an_exact_timeline_entry_and_span(client):
    status, data = client("clinician").get("/api/patients/patient-ava")
    assert status == 200
    entries = {entry["id"]: entry for entry in data["entries"]}
    assert data["highlights"]
    for highlight in data["highlights"]:
        source = entries[highlight["entryId"]]
        assert highlight["versionId"] == source["versionId"]
        assert 0 <= highlight["spanStart"] < highlight["spanEnd"] <= len(source["content"])
