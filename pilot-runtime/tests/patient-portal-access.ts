import assert from "node:assert/strict";
import { shouldLoadPatientPortal } from "../app/patient-portal-access";

assert.equal(shouldLoadPatientPortal(0), true, "an authenticated user without a clinic role may still have a patient portal grant");
assert.equal(shouldLoadPatientPortal(1), false, "clinical members load their clinic workspace instead");
process.stdout.write("Patient portal access routing tests passed.\n");
