/** Only stable protocol codes may reach the browser or development log. */
export function safeCallbackErrorCode(error: unknown): string {
  const record = error && typeof error === "object" ? error as { code?: unknown; cause?: unknown } : {};
  const cause = record.cause && typeof record.cause === "object" ? record.cause as { code?: unknown } : undefined;
  const candidate = cause?.code ?? record.code;
  return typeof candidate === "string" && /^[a-z0-9_]{1,80}$/i.test(candidate) ? candidate : "authorization_error";
}
