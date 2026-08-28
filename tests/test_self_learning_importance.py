from conftest import run_pilot_micro

def test_pinning_increases_the_priority_of_a_similar_future_pilot_highlight():
    run_pilot_micro("importance")
