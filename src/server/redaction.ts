export function redactForLlm(source: string) {
  const redacted = source
    .replace(/\b\d{8,12}[A-Z]?\b/g, "[ID]")
    .replace(/\b(?:\+?65[- ]?)?\d{4}[- ]?\d{4}\b/g, "[PHONE]")
    .replace(/\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g, "[NAME]");
  return { redacted, mapping: "server-only token mapping retained with entry version" };
}
