# Keep the Demo and Pilot Runtime separate

The existing local application will remain a synthetic-data Demo for design validation. A new Pilot Runtime will be built beside it with managed identity, Postgres RLS, transactions, migrations, the outbox, and governed integrations. User experience, domain language, scenario fixtures, and test intent may transfer, but an unauthenticated local storage model will not be hardened in place and presented as Pilot-safe.
