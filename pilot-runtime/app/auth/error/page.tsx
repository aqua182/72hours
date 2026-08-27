import { safeCallbackErrorCode } from "../../../src/auth/callback-error";

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  const value = (await searchParams).reason;
  const reason = safeCallbackErrorCode({ code: Array.isArray(value) ? undefined : value });

  return (
    <main style={{ maxWidth: 680, margin: "80px auto", padding: 32, fontFamily: "Arial, sans-serif" }}>
      <p style={{ color: "#087f72", fontWeight: 700, letterSpacing: "0.08em" }}>NIGHTINGALE · PILOT</p>
      <h1>We could not complete sign-in.</h1>
      <p>Safe diagnostic code: <code>{reason}</code></p>
      <p>This page never displays credentials, tokens, or patient data. Return to the Pilot and try again after the Auth0 application settings have been checked.</p>
      <a href="/" style={{ color: "#087f72", fontWeight: 700 }}>Return to Pilot</a>
    </main>
  );
}
