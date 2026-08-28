from conftest import run_pilot_micro

def test_real_pilot_concurrent_edits_preserve_distinct_sections_and_reject_stale_writes():
    run_pilot_micro("concurrency")
