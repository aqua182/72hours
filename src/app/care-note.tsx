"use client";
import { useEffect, useMemo, useState } from "react";

type AppData = any;
const roleLabel: Record<string, string> = { patient: "Patient", staff: "Staff", clinician: "Clinician", admin: "Admin" };

export default function CareNote() {
  const [role, setRole] = useState("clinician");
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const login = async (nextRole = role) => {
    setLoading(true); setRole(nextRole);
    await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
    const result = await fetch("/api/patients/patient-ava");
    setData(await result.json()); setLoading(false);
  };
  useEffect(() => { login("clinician"); }, []);
  const internal = data?.user?.role !== "patient";
  const act = async (id: string, action: string) => { await fetch(`/api/highlights/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, dismissReason: action === "dismissed" ? "not clinically relevant" : undefined }) }); setNotice(`Highlight ${action}. Evidence state and audit trail updated.`); await login(role); };
  const claim = async (id: string) => { const response = await fetch(`/api/tasks/${id}/claim`, { method: "POST" }); const result = await response.json(); setNotice(result.claimed ? "Review task claimed and assigned to you." : "This review task is already assigned."); await login(role); };
  const resetDemo = async () => { await fetch("/api/demo/reset", { method: "POST" }); setNotice("Synthetic demo reset: Highlights and tasks are ready to demonstrate again."); await login(role); };
  const visibleHighlights = useMemo(() => (data?.highlights ?? []).slice(0, 3), [data]);
  if (loading || !data) return <main className="loading">Loading trusted care context…</main>;
  return <main>
    <header className="topbar">
      <div><span className="brand-mark">N</span><strong>Nightingale</strong><span className="muted">Care Note / Synthetic demo</span></div>
      <div className="session-controls">{data?.user?.role === "admin" && <button className="reset" onClick={resetDemo}>Reset demo state</button>}<label>Demo identity <select value={role} onChange={(e) => login(e.target.value)}>{Object.keys(roleLabel).map((key) => <option key={key} value={key}>{roleLabel[key]}</option>)}</select></label></div>
    </header>
    <section className="patient-header">
      <div><p className="eyebrow">CLINIC-SCOPED RECORD · {roleLabel[data.user.role].toUpperCase()}</p><h1>{data.patient.displayName}</h1><p>DOB {data.patient.dob} · One shared, source-linked longitudinal record</p></div>
      <div className="status"><span className="dot"></span> Live care context <small>Warm path: indexed view</small></div>
    </section>
    {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
    {internal ? <>
      <section className="glance">
        <div className="section-heading"><div><p className="eyebrow">10-SECOND CONSULT VIEW</p><h2>What needs attention now</h2></div><span className="trust-chip">Every card links to source</span></div>
        <div className="highlight-grid">{visibleHighlights.map((h: any, i: number) => <article key={h.id} className={`highlight h${i}`}>
          <div className="card-top"><span className="signal">{h.status === "accepted" ? "CLINICIAN CONFIRMED" : i === 0 ? "REVIEW REQUIRED" : "RECENT CHANGE"}</span><span className="score">Why shown</span></div>
          <h3>{h.title}</h3><p>{h.riskReason}</p><div className="source-line">◉ Source-linked · {h.evidenceState.replace("-", " ")}</div>
          <div className="actions"><button className="link" onClick={() => document.getElementById(h.entryId)?.scrollIntoView({ behavior: "smooth", block: "center" })}>View source ↗</button>{h.status === "accepted" ? <span className="confirmed">✓ Confirmed</span> : data.user.role === "clinician" && <button className="solid" onClick={() => act(h.id, "accepted")}>Accept</button>}</div>
        </article>)}</div>
      </section>
      <section className="two-col">
        <div className="panel"><div className="panel-title"><h2>Open actions</h2><span>{data.tasks.length} active</span></div>{data.tasks.map((task: any) => <div className="task" key={task.id}><div><span className={task.reviewRequired ? "risk-dot" : "task-dot"}></span><strong>{task.title}</strong><p>{task.assigneeName ? `Owned by ${task.assigneeName}` : "Unassigned · team member must review"} · due {task.dueAt?.slice(0, 10)}</p></div>{!task.assigneeId && <button onClick={() => claim(task.id)}>Claim</button>}</div>)}</div>
        <div className="panel plan"><div className="panel-title"><h2>Current Clinical Plan</h2><span>Clinician-owned</span></div><p>Stop amoxicillin pending review. Document suspected penicillin allergy. Arrange same-day clinician review.</p><small>New clinician content takes precedence; conflicting older evidence stays inspectable.</small></div>
      </section>
    </> : <section className="patient-view"><p className="eyebrow">PATIENT-FACING SUMMARY</p><h2>Your instructions</h2><p>Please stop the medicine discussed today and contact the clinic promptly if the rash worsens or you develop breathing difficulty.</p><div className="safe-note">Internal staff comments, tasks, raw AI notes, and clinical review signals are not available in this view.</div></section>}
    <section className="timeline"><div className="section-heading"><div><p className="eyebrow">SOURCE OF TRUTH</p><h2>Longitudinal Timeline</h2></div><span className="muted">Click a Glance card to locate its evidence</span></div>{data.entries.map((entry: any) => <article id={entry.id} key={entry.id} className="entry"><div className={`avatar ${entry.authorRole}`}>{entry.authorRole === "system" ? "AI" : entry.authorName.split(" ").map((n: string) => n[0]).join("")}</div><div className="entry-body"><div className="entry-meta"><strong>{entry.authorRole === "system" ? "System / AI Scribe" : entry.authorName}</strong><span>{entry.type.replaceAll("_", " ")}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div><p>{entry.content}</p>{entry.provenancePointer && <div className="provenance">↗ Provenance: {entry.provenancePointer} · version {entry.currentVersion}</div>}</div></article>)}</section>
  </main>;
}
