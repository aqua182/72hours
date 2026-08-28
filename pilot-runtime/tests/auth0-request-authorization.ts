import assert from "node:assert/strict";
import { authorizationForPilotRequest } from "../src/auth/request-authorization";

async function run() {
  const directBearer = await authorizationForPilotRequest(
    new Request("http://localhost/api", { headers: { authorization: "Bearer direct-api-token" } }),
    async () => ({ tokenSet: { accessToken: "session-token" } }),
  );
  assert.equal(directBearer, "Bearer direct-api-token");

  const browserSession = await authorizationForPilotRequest(
    new Request("http://localhost/api"),
    async () => ({ tokenSet: { accessToken: "session-token" } }),
  );
  assert.equal(browserSession, "Bearer session-token");

  const anonymous = await authorizationForPilotRequest(new Request("http://localhost/api"), async () => null);
  assert.equal(anonymous, null);

  process.stdout.write("Auth0 request authorization tests passed.\n");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
