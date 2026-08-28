/**
 * A Risk Flag is rule-derived, not a model-assigned ordinal label. Importance
 * affects reading order only; it is never interpreted as clinical severity.
 */
export type ValidatedClaimSignal = {
  claimId: string;
  entityType: "allergy" | "medication" | "symptom" | "follow_up";
  normalizedValue: string;
};

export type DeterministicRiskFlag = {
  ruleId: "allergy-medication-conflict" | "breathing-difficulty" | "overdue-renal-follow-up";
  ruleVersion: "risk-rules-v1";
  title: string;
  riskReason: string;
  importance: number;
  evidenceClaimIds: string[];
};

const ruleVersion = "risk-rules-v1" as const;

function claimsOf(claims: ValidatedClaimSignal[], entityType: ValidatedClaimSignal["entityType"], normalizedValue: string) {
  return claims.filter((claim) => claim.entityType === entityType && claim.normalizedValue === normalizedValue);
}

/** Same validated claim set always produces the same flags in the same order. */
export function evaluateDeterministicRiskRules(claims: ValidatedClaimSignal[]): DeterministicRiskFlag[] {
  const flags: DeterministicRiskFlag[] = [];
  const penicillinAllergies = claimsOf(claims, "allergy", "penicillin");
  const amoxicillinMedications = claimsOf(claims, "medication", "amoxicillin");
  if (penicillinAllergies.length > 0 && amoxicillinMedications.length > 0) {
    flags.push({
      ruleId: "allergy-medication-conflict",
      ruleVersion,
      title: "Possible antibiotic reaction",
      riskReason: "A penicillin allergy claim and amoxicillin medication claim coexist in the sourced evidence.",
      importance: 95,
      evidenceClaimIds: [...penicillinAllergies, ...amoxicillinMedications].map((claim) => claim.claimId).sort(),
    });
  }

  const breathingDifficulty = claimsOf(claims, "symptom", "breathing_difficulty_present");
  if (breathingDifficulty.length > 0) {
    flags.push({
      ruleId: "breathing-difficulty",
      ruleVersion,
      title: "Breathing difficulty needs review",
      riskReason: "Sourced evidence reports breathing difficulty as present.",
      importance: 95,
      evidenceClaimIds: breathingDifficulty.map((claim) => claim.claimId).sort(),
    });
  }

  const overdueRenalFollowUps = claimsOf(claims, "follow_up", "renal_blood_test_overdue");
  if (overdueRenalFollowUps.length > 0) {
    flags.push({
      ruleId: "overdue-renal-follow-up",
      ruleVersion,
      title: "Renal blood test remains open",
      riskReason: "Sourced evidence marks a renal blood-test follow-up as overdue.",
      importance: 72,
      evidenceClaimIds: overdueRenalFollowUps.map((claim) => claim.claimId).sort(),
    });
  }

  return flags;
}
