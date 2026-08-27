import { auth0 } from "./auth0";
import { authorizationForPilotRequest } from "./request-authorization";
import { verifyOidcBearer, type VerifiedIdentity } from "./verified-identity";

export async function verifyPilotRequest(request: Request): Promise<VerifiedIdentity> {
  const authorization = await authorizationForPilotRequest(request, () => auth0.getSession());
  return verifyOidcBearer(authorization);
}
