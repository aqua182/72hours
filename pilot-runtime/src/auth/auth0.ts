import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";
import { safeCallbackErrorCode } from "./callback-error";

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
  onCallback: async (error, context) => {
    const appBaseUrl = context.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3001";
    if (error) {
      const reason = safeCallbackErrorCode(error);
      console.error(`[pilot-auth-callback] code=${reason}`);
      return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, appBaseUrl));
    }
    return NextResponse.redirect(new URL(context.returnTo ?? "/", appBaseUrl));
  },
});
