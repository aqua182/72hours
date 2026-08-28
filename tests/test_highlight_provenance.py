from conftest import run_pilot_micro

def test_ai_scribed_highlight_provenance_resolves_to_an_immutable_pilot_span():
    run_pilot_micro("provenance")
