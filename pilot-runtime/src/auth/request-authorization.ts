export type BrowserSession = { tokenSet?: { accessToken?: string | undefined } | undefined } | null;

/**
 * Accepts an API bearer token for non-browser clients, otherwise obtains the
 * access token from the server-side Auth0 session. In both cases the token is
 * still cryptographically verified before any database transaction begins.
 */
export async function authorizationForPilotRequest(request: Request, readSession: () => Promise<BrowserSession>): Promise<string | null> {
  const supplied = request.headers.get("authorization");
  if (supplied?.startsWith("Bearer ")) return supplied;

  const session = await readSession();
  const accessToken = session?.tokenSet?.accessToken;
  return accessToken ? `Bearer ${accessToken}` : null;
}
