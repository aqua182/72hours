# Import EHR context as immutable snapshots without writeback

FHIR data will enter the Pilot as time-stamped, read-only snapshots that append to the Care Note Timeline. Imports must display Sync Status and cannot overwrite a Clinical Plan, task, or prior provenance. Nightingale will not write back to the EHR during the Pilot; this preserves the EHR's authority while making freshness and disagreement explicit.
