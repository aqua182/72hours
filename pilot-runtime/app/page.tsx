import { auth0 } from "../src/auth/auth0";

const shell: React.CSSProperties = { maxWidth: 760, margin: "80px auto", padding: 32 };
const card: React.CSSProperties = { background: "white", border: "1px solid #d6dedb", borderRadius: 16, padding: 32, boxShadow: "0 8px 24px rgba(21,36,43,0.06)" };
const button: React.CSSProperties = { display: "inline-block", background: "#087f72", color: "white", borderRadius: 8, padding: "12px 16px", fontWeight: 700, textDecoration: "none" };

export default async function PilotHome() {
  const session = await auth0.getSession();
  const email = typeof session?.user.email === "string" ? session.user.email : "Authenticated Pilot user";

  return (
    <main style={shell}>
      <p style={{ color: "#087f72", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>NIGHTINGALE · PILOT</p>
      <h1 style={{ fontSize: 42, margin: "0 0 16px" }}>Care collaboration, with a verified identity.</h1>
      <section style={card}>
        {session ? (
          <>
            <p style={{ marginTop: 0 }}>Signed in as <strong>{email}</strong>.</p>
            <p>Access to a clinic and its patients is granted separately through Clinic Memberships. Signing in never grants clinical access by itself.</p>
            <a href="/auth/logout" style={button}>Sign out</a>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>Use your approved Pilot identity to continue.</p>
            <p>No synthetic role switcher is available in this service. Every patient request requires a verified token and clinic-scoped membership.</p>
            <a href="/auth/login" style={button}>Sign in securely</a>
          </>
        )}
      </section>
    </main>
  );
}
