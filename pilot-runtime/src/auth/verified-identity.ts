import { createRemoteJWKSet, jwtVerify } from "jose";

export type VerifiedIdentity = {
  subject: string;
  issuer: string;
  audience: string;
};

function required(name: "OIDC_ISSUER_URL" | "OIDC_AUDIENCE" | "OIDC_JWKS_URL") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in the Pilot Runtime`);
  return value;
}

/**
 * Verifies a bearer token before any clinic lookup or database transaction.
 * A client-selected role or user id is never accepted as an identity input.
 */
export async function verifyOidcBearer(authorization: string | null): Promise<VerifiedIdentity> {
  if (!authorization?.startsWith("Bearer ")) throw new Error("missing bearer token");
  const issuer = required("OIDC_ISSUER_URL");
  const audience = required("OIDC_AUDIENCE");
  const jwks = createRemoteJWKSet(new URL(required("OIDC_JWKS_URL")));
  const { payload } = await jwtVerify(authorization.slice("Bearer ".length), jwks, { issuer, audience });
  if (!payload.sub) throw new Error("verified token has no subject");
  return { subject: payload.sub, issuer, audience };
}
