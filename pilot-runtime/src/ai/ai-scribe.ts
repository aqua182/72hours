import { z } from "zod";

const interactionTypes = ["ai_doctor_consult_summary", "ai_nurse_consult_summary", "ai_patient_session_summary"] as const;
export type AiInteractionType = (typeof interactionTypes)[number];
const draftSchema = z.object({ summary: z.string().trim().min(1).max(8_000), keyQuestions: z.array(z.string().trim().min(1).max(300)).max(5).default([]) });

function deterministicDraft(source: string, type: AiInteractionType) {
  const firstSentences = source.split(/(?<=[.!?。！？])\s+/).filter(Boolean).slice(0, 3).join(" ");
  return { summary: `${type.replaceAll("_", " ")}: ${firstSentences || source}`, keyQuestions: [] as string[], provider: "local-deterministic" };
}

/** Calls an explicitly configured provider only after the caller has redacted input. */
export async function createAiScribeDraft(redactedSource: string, type: AiInteractionType) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return deterministicDraft(redactedSource, type);
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON only: {\"summary\":string,\"keyQuestions\":string[]}. You summarize synthetic clinical interaction text. Do not diagnose, infer missing facts, provide treatment advice, or claim certainty. Preserve uncertainty and use concise factual language." },
        { role: "user", content: `Interaction type: ${type}\nRedacted source:\n${redactedSource}` },
      ],
      max_tokens: 800,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("AI_PROVIDER_FAILED");
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const parsed = draftSchema.safeParse(JSON.parse(payload.choices?.[0]?.message?.content || "{}"));
  if (!parsed.success) throw new Error("AI_PROVIDER_INVALID_OUTPUT");
  return { summary: [parsed.data.summary, ...parsed.data.keyQuestions.map((question) => `Key question: ${question}`)].join("\n"), keyQuestions: parsed.data.keyQuestions, provider: "deepseek" };
}
