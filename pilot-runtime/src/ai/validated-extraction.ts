import { z } from "zod";

/**
 * This describes extraction output, not a clinical inference. Source offsets
 * are validated against the immutable Entry Version before persistence.
 */
export const extractedClaimSchema = z.object({
  entryVersionId: z.string().uuid(),
  spanStart: z.number().int().nonnegative(),
  spanEnd: z.number().int().positive(),
  entityType: z.enum(["allergy", "medication", "symptom", "follow_up"]),
  normalizedValue: z.string().trim().min(1).max(200),
  extractionConfigVersion: z.string().trim().min(1).max(100),
}).refine((claim) => claim.spanEnd > claim.spanStart, { message: "spanEnd must be after spanStart", path: ["spanEnd"] });

export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;

export function validateExtractedClaims(candidate: unknown): ExtractedClaim[] {
  return z.array(extractedClaimSchema).min(1).max(100).parse(candidate);
}
