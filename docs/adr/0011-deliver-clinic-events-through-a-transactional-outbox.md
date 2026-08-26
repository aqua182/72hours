# Deliver clinic events through a transactional outbox

The Pilot will record a clinic-scoped Outbox Event in the same transaction as each Care Note mutation, then deliver it to authorized subscribers. This replaces browser polling and direct database broadcast with a retryable, auditable event stream that cannot announce a change which failed to commit.
