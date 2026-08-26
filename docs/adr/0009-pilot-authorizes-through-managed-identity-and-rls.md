# Pilot authorization uses managed identity and Row-Level Security

The Pilot will replace development role cookies and local SQLite authorization with managed identity, verified Clinic Membership, Postgres, and Row-Level Security. Application-level authorization remains a second check, but the database must independently prevent a user from reading or mutating another clinic's records. This is a non-negotiable boundary for a clinician-led Pilot, not a later optimization.
