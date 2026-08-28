# Provenance binds to immutable entry versions

Each Evidence Claim and Highlight will store an entry version identifier and text span, not a moving reference to an Entry's current content. When the source is edited, the historical claim remains inspectable and is marked as sourced from a superseded version; it is never silently repointed or deleted. This preserves auditability, makes reverts meaningful, and ensures a provenance link always describes the text from which a signal was derived.
