import assert from "node:assert/strict";
import { evaluateDeterministicRiskRules } from "../src/ai/deterministic-risk-rules";
import { redactForModel } from "../src/ai/redaction";
import { validateExtractedClaims } from "../src/ai/validated-extraction";

const source = "Patient name: Ava Tan. 姓名：王小明。 Contact ava.tan@example.test on +65 8123 4567. Patient ID 12345678.";
const redacted = redactForModel(source);
assert.equal(redacted.redactedText.includes("ava.tan@example.test"), false);
assert.equal(redacted.redactedText.includes("8123 4567"), false);
assert.equal(redacted.redactedText.includes("Ava Tan"), false);
assert.equal(redacted.redactedText.includes("王小明"), false);
assert.ok(redacted.sourceRanges.length >= 5, "names, email, phone, and ID-like numbers must all be redacted");

const claims = validateExtractedClaims([
  { entryVersionId: "00000000-0000-4000-8000-000000000001", spanStart: 0, spanEnd: 8, entityType: "allergy", normalizedValue: "penicillin", extractionConfigVersion: "extract-v1" },
  { entryVersionId: "00000000-0000-4000-8000-000000000001", spanStart: 9, spanEnd: 19, entityType: "medication", normalizedValue: "amoxicillin", extractionConfigVersion: "extract-v1" },
  { entryVersionId: "00000000-0000-4000-8000-000000000001", spanStart: 20, spanEnd: 31, entityType: "symptom", normalizedValue: "breathing_difficulty_present", extractionConfigVersion: "extract-v1" },
  { entryVersionId: "00000000-0000-4000-8000-000000000001", spanStart: 32, spanEnd: 43, entityType: "follow_up", normalizedValue: "renal_blood_test_overdue", extractionConfigVersion: "extract-v1" },
]);
const signals = claims.map((claim, index) => ({ claimId: `claim-${index}`, entityType: claim.entityType, normalizedValue: claim.normalizedValue }));
const first = evaluateDeterministicRiskRules(signals);
const second = evaluateDeterministicRiskRules([...signals].reverse());
assert.deepEqual(first, second);
assert.deepEqual(first.map((flag) => flag.ruleId), ["allergy-medication-conflict", "breathing-difficulty", "overdue-renal-follow-up"]);
assert.equal(JSON.stringify(first).includes("confidence"), false);
assert.throws(() => validateExtractedClaims([{ ...claims[0], spanEnd: 0 }]), /spanEnd/);

console.log("PASS: redaction, extraction validation, and deterministic risk rules are repeatable and contain no model confidence.");
