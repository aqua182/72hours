export type RedactedSource = {
  redactedText: string;
  /** Server-only mapping. Never send this map to the model or browser. */
  sourceRanges: Array<{ redactedStart: number; redactedEnd: number; sourceStart: number; sourceEnd: number }>;
};

const sensitiveTokens = [
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:\+?\d[\d -]{7,}\d)\b/g,
  /\b\d{6,}\b/g,
];

/** Redacts common direct identifiers while retaining a server-only offset map. */
export function redactForModel(source: string): RedactedSource {
  const matches = sensitiveTokens.flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))).sort((left, right) => left.start - right.start);
  const nonOverlapping = matches.filter((match, index) => index === 0 || match.start >= matches[index - 1].end);
  let cursor = 0;
  let redactedText = "";
  const sourceRanges: RedactedSource["sourceRanges"] = [];
  for (const match of nonOverlapping) {
    redactedText += source.slice(cursor, match.start);
    const placeholder = "[REDACTED]";
    const redactedStart = redactedText.length;
    redactedText += placeholder;
    sourceRanges.push({ redactedStart, redactedEnd: redactedStart + placeholder.length, sourceStart: match.start, sourceEnd: match.end });
    cursor = match.end;
  }
  return { redactedText: redactedText + source.slice(cursor), sourceRanges };
}
