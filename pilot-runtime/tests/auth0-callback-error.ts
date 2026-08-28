import assert from "node:assert/strict";
import { safeCallbackErrorCode } from "../src/auth/callback-error";

assert.equal(safeCallbackErrorCode({ cause: { code: "access_denied" }, code: "authorization_error" }), "access_denied");
assert.equal(safeCallbackErrorCode({ code: "authorization_error" }), "authorization_error");
assert.equal(safeCallbackErrorCode({ cause: { code: "secret=do-not-show" } }), "authorization_error");
process.stdout.write("Auth0 callback error tests passed.\n");
