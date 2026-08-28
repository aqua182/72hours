export type RedactedSource = {
  redactedText: string;
  /** Server-only mapping. Never send this map to the model or browser. */
  sourceRanges: Array<{ redactedStart: number; redactedEnd: number; sourceStart: number; sourceEnd: number }>;
};

const sensitiveTokens = [
  /\b(?:patient\s+name|name)\s*[:：]\s*(?:[A-Z][a-z'-]*\s+){1,3}[A-Z][a-z'-]*\b/gi,
  /\b(?:Mr|Mrs|Ms|Miss|Dr)\.\s+[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*){0,2}\b/g,
  /(?:姓名|患者姓名)\s*[:：]\s*[\u4E00-\u9FFF]{2,4}/g,
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
