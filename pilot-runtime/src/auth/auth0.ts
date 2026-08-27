import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Browser sessions are created only by Auth0's authorization-code flow. The
 * audience is explicit so the session includes an access token for the Pilot
 * API; no browser-supplied role or user identifier is trusted.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: process.env.AUTH0_SCOPE ?? "openid profile email",
  },
});
