# Redact before the LLM and audit the boundary

All text sent to an LLM will pass through a redaction pipeline that removes names, IC/ID numbers, and phone numbers, even when the prototype uses synthetic data. The system will retain an auditable relationship between source Entry, Redacted Prompt, and generated output, while keeping raw clinical text out of LLM payloads and application logs. This makes the prototype's privacy posture testable rather than declarative.
