import { auth0 } from "./src/auth/auth0";

/** Auth0 mounts /auth/login, /auth/logout, and /auth/callback through Proxy. */
export async function proxy(request: Request) {
  return auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
