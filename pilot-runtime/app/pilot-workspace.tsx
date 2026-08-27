"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Role = "staff" | "clinician" | "admin";
type Membership = { clinicId: string; clinicName: string; role: Role };
type Patient = { id: string; displayLabel: string };
type Entry = { id: string; type: string; authorRole: string; currentVersion: number; content: string; changedAt: string; provenancePointer: string | null };
type Highlight = { id: string; title: string; status: string; importance: number; baseImportance: number; learningBoost: number; riskReason: string; evidenceState: string; entityType: string; sourceEntryId: string; sourceEntryVersionId: string; spanStart: number; spanEnd: number };
type CareNote = { patient: { id: string; displayLabel: string; externalReference: string }; entries: Entry[]; highlights: Highlight[]; openTasks: Array<{ id: string; title: string; status: string; reviewRequired: boolean; dueAt: string | null }> };
type Workbench = { highlightId: string; title: string; riskReason: string; importance: number; highlightStatus: string; ruleVersion: string; evidenceState: string; entityType: string; normalizedValue: string; extractionConfigVersion: string; sourceEntryId: string; sourceEntryVersionId: string; spanStart: number; spanEnd: number; sourceExcerpt: string };
type Comment = { id: string; parentCommentId: string | null; body: string; authorRole: string; status: "open" | "resolved"; mentionedName: string | null; assigneeName: string | null; createdAt: string };
type Version = { id: string; version: number; content: string; changedAt: string; changedByRole: string };

const panel: React.CSSProperties = { border: "1px solid #d6dedb", borderRadius: 14, padding: 20, background: "#fff", boxShadow: "0 5px 16px rgba(21,36,43,0.05)" };
const action: React.CSSProperties = { border: 0, borderRadius: 7, padding: "9px 12px", fontWeight: 700, cursor: "pointer", background: "#087f72", color: "#fff" };
const secondary: React.CSSProperties = { ...action, background: "#e7f5f1", color: "#087f72" };
const input: React.CSSProperties = { display: "block", boxSizing: "border-box", width: "100%", minHeight: 72, margin: "8px 0", border: "1px solid #aebbb7", borderRadius: 8, padding: 10, font: "inherit" };

async function responseJson<T>(request: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(request, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "REQUEST_FAILED");
  return payload as T;
}
function label(value: string) { return value.replaceAll("_", " "); }
function sourceMarkedContent(entry: Entry, source: Workbench | undefined) {
  if (!source || source.sourceEntryId !== entry.id) return entry.content;
  return <>{entry.content.slice(0, source.spanStart)}<mark style={{ background: "#ffe08a", padding: "0 2px" }}>{entry.content.slice(source.spanStart, source.spanEnd)}</mark>{entry.content.slice(source.spanEnd)}</>;
}

export default function PilotWorkspace() {
  const [memberships, setMemberships] = useState<Membership[] | undefined>();
  const [selectedClinic, setSelectedClinic] = useState<Membership>();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [careNote, setCareNote] = useState<CareNote>();
  const [workbench, setWorkbench] = useState<Workbench>();
  const [activeEntry, setActiveEntry] = useState<Entry>();
  const [comments, setComments] = useState<Comment[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [entryContent, setEntryContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [aiType, setAiType] = useState<"ai_doctor_consult_summary" | "ai_nurse_consult_summary" | "ai_patient_session_summary">("ai_doctor_consult_summary");
  const [aiSource, setAiSource] = useState("");
  const [summaryTitle, setSummaryTitle] = useState("Your care plan");
  const [summaryContent, setSummaryContent] = useState("");
  const [patientSummaries, setPatientSummaries] = useState<Array<{ patientId: string; displayLabel: string; title: string; content: string; updatedAt: string }>>([]);
  const [message, setMessage] = useState<string>();
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const captureChunks = useRef<Blob[]>([]);
  const [capturing, setCapturing] = useState(false);

  const loadCareNote = useCallback(async (clinic: Membership, patient: Patient) => {
    const result = await responseJson<CareNote>(`/api/patients/${patient.id}/care-note?clinicId=${encodeURIComponent(clinic.clinicId)}`);
    setCareNote(result);
  }, []);
  const loadClinic = useCallback(async (clinic: Membership) => {
    setSelectedClinic(clinic); setWorkbench(undefined); setActiveEntry(undefined); setComments([]); setVersions([]);
    const directory = await responseJson<{ patients: Patient[] }>(`/api/clinics/${clinic.clinicId}/patients`);
    setPatients(directory.patients);
    if (directory.patients[0]) await loadCareNote(clinic, directory.patients[0]); else setCareNote(undefined);
  }, [loadCareNote]);
  const refresh = useCallback(async () => {
    try {
      const result = await responseJson<{ memberships: Membership[] }>("/api/memberships");
      setMemberships(result.memberships);
      if (!selectedClinic && result.memberships[0]) await loadClinic(result.memberships[0]);
      else if (selectedClinic && careNote) await loadCareNote(selectedClinic, careNote.patient);
    } catch (error) { setMemberships([]); setMessage(error instanceof Error && error.message === "NOT_PROVISIONED" ? "Your verified identity has no active Clinic Membership yet." : "We could not load your Pilot access."); }
  }, [careNote, loadCareNote, loadClinic, selectedClinic]);
  useEffect(() => {
    void (async () => {
      try {
        const result = await responseJson<{ memberships: Membership[] }>("/api/memberships");
        setMemberships(result.memberships);
        if (result.memberships[0]) await loadClinic(result.memberships[0]);
      } catch (error) {
        setMemberships([]);
        if (error instanceof Error && error.message === "NOT_PROVISIONED") {
          try { setPatientSummaries((await responseJson<{ summaries: Array<{ patientId: string; displayLabel: string; title: string; content: string; updatedAt: string }> }>("/api/patient-summaries")).summaries); } catch { /* no portal access is expected for a non-member */ }
          setMessage("Your verified identity has no active Clinic Membership yet.");
        } else setMessage("We could not load your Pilot access.");
      }
    })();
  }, [loadClinic]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && selectedClinic && careNote) void loadCareNote(selectedClinic, careNote.patient); }, 8_000);
    return () => window.clearInterval(timer);
  }, [careNote, loadCareNote, selectedClinic]);
  useEffect(() => {
    if (!selectedClinic || !careNote) return;
    const events = new EventSource(`/api/patients/${careNote.patient.id}/events?clinicId=${encodeURIComponent(selectedClinic.clinicId)}`);
    events.addEventListener("care-note-changed", () => { void loadCareNote(selectedClinic, careNote.patient); });
    return () => events.close();
  }, [careNote?.patient.id, loadCareNote, selectedClinic]);

  const loadEntryCollaboration = useCallback(async (entry: Entry) => {
    if (!selectedClinic) return;
    setActiveEntry(entry); setEditContent(entry.content);
    const [commentResult, versionResult] = await Promise.all([
      responseJson<{ comments: Comment[] }>(`/api/care-entries/${entry.id}/comments?clinicId=${encodeURIComponent(selectedClinic.clinicId)}`),
      responseJson<{ versions: Version[] }>(`/api/care-entries/${entry.id}/versions?clinicId=${encodeURIComponent(selectedClinic.clinicId)}`),
    ]);
    setComments(commentResult.comments); setVersions(versionResult.versions);
  }, [selectedClinic]);

  async function reviewHighlight(highlightId: string, decision: "accepted" | "rejected" | "pinned") {
    if (!selectedClinic || !careNote) return;
    try { await responseJson(`/api/highlights/${highlightId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, decision }) }); await loadCareNote(selectedClinic, careNote.patient); setMessage(decision === "accepted" || decision === "pinned" ? "Decision recorded. Future suggestions of this evidence type receive a bounded clinic-specific relevance boost." : "Review decision recorded with its audit trail."); } catch { setMessage("That review action is not permitted for this membership."); }
  }
  async function showSource(highlight: Highlight) {
    if (!selectedClinic) return;
    try {
      const source = await responseJson<Workbench>(`/api/highlights/${highlight.id}?clinicId=${encodeURIComponent(selectedClinic.clinicId)}`);
      setWorkbench(source);
      window.setTimeout(() => document.getElementById(`entry-${source.sourceEntryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
    } catch { setMessage("The source evidence could not be loaded."); }
  }
  async function claimOrCloseTask(task: CareNote["openTasks"][number]) {
    if (!selectedClinic || !careNote) return;
    try {
      if (task.status === "open") { await responseJson(`/api/review-tasks/${task.id}/claim`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId }) }); setMessage("Review task claimed."); }
      else if (task.reviewRequired && selectedClinic.role === "clinician") { await responseJson(`/api/review-tasks/${task.id}/close`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, reason: "clinician_confirmed" }) }); setMessage("Review task closed with a clinician-confirmed decision."); }
      await loadCareNote(selectedClinic, careNote.patient);
    } catch { setMessage("The task state changed or this membership cannot complete that action."); }
  }
  async function addEntry() {
    if (!selectedClinic || !careNote || !entryContent.trim()) return;
    try { const type = selectedClinic.role === "staff" ? "staff_note" : "clinician_note"; await responseJson("/api/care-entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, patientId: careNote.patient.id, type, content: entryContent }) }); setEntryContent(""); await loadCareNote(selectedClinic, careNote.patient); setMessage("New immutable Timeline Entry created."); } catch { setMessage("The entry could not be created for this membership."); }
  }
  async function editEntry() {
    if (!selectedClinic || !careNote || !activeEntry || !editContent.trim()) return;
    try { await responseJson(`/api/care-entries/${activeEntry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, expectedVersion: activeEntry.currentVersion, content: editContent }) }); await loadCareNote(selectedClinic, careNote.patient); setMessage("New immutable version recorded. Open its history to compare or revert."); } catch (error) { setMessage(error instanceof Error && error.message === "VERSION_CONFLICT" ? "Another editor saved first. The Timeline has been refreshed; review the new version before retrying." : "This role cannot edit that entry."); }
  }
  async function addComment() {
    if (!selectedClinic || !activeEntry || !commentBody.trim()) return;
    try { await responseJson(`/api/care-entries/${activeEntry.id}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, body: commentBody }) }); setCommentBody(""); await loadEntryCollaboration(activeEntry); setMessage("Threaded comment added to the audit trail."); } catch { setMessage("Comment could not be saved."); }
  }
  async function setResolution(comment: Comment) {
    if (!selectedClinic || !activeEntry) return;
    try { await responseJson(`/api/comments/${comment.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, resolved: comment.status !== "resolved" }) }); await loadEntryCollaboration(activeEntry); } catch { setMessage("This membership cannot change that comment state."); }
  }
  async function revert(version: Version) {
    if (!selectedClinic || !activeEntry || !careNote) return;
    try { await responseJson(`/api/care-entries/${activeEntry.id}/revert`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, sourceVersion: version.version, expectedVersion: activeEntry.currentVersion }) }); await loadCareNote(selectedClinic, careNote.patient); setMessage(`Restored version ${version.version} as a new immutable version; history is retained.`); } catch { setMessage("Revert did not apply because the entry changed or this role cannot edit it."); }
  }
  async function addAiSummary() {
    if (!selectedClinic || !careNote || !aiSource.trim()) return;
    try { await responseJson("/api/ai-scribed-entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, patientId: careNote.patient.id, type: aiType, sourceText: aiSource }) }); setAiSource(""); await loadCareNote(selectedClinic, careNote.patient); setMessage("Governed AI-scribed draft created from redacted source text. It remains distinct from clinician notes and requires review."); } catch { setMessage("AI-scribed intake could not be created."); }
  }
  async function publishSummary() {
    if (!selectedClinic || !careNote || !summaryTitle.trim() || !summaryContent.trim()) return;
    try { await responseJson(`/api/patients/${careNote.patient.id}/patient-summary`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, title: summaryTitle, content: summaryContent }) }); setMessage("Patient-facing summary published. It is isolated from internal notes and raw AI entries."); } catch { setMessage("Only clinicians or administrators can publish a patient-facing summary."); }
  }
  async function toggleVoiceCapture() {
    if (capturing) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(stream); captureChunks.current = [];
      next.ondataavailable = (event) => { if (event.data.size) captureChunks.current.push(event.data); };
      next.onstop = () => { stream.getTracks().forEach((track) => track.stop()); setCapturing(false); setMessage("Synthetic voice clip captured locally and not uploaded. Production transcription is intentionally disabled until a PHI-safe, approved transcription processor is configured."); };
      recorder.current = next; next.start(); setCapturing(true);
    } catch { setMessage("Microphone access was not available."); }
  }

  if (!memberships) return <section style={panel}><p style={{ margin: 0 }}>Checking Clinic Memberships…</p></section>;
  if (!memberships.length) return patientSummaries.length ? <section style={panel}><p style={{ color: "#087f72", fontWeight: 700, letterSpacing: "0.06em", marginTop: 0 }}>PATIENT-FACING VIEW</p><h2 style={{ marginTop: 0 }}>Your shared care updates</h2><p>Only clinician-published instructions appear here. Internal comments, staff notes and raw AI-scribed notes are never returned to this view.</p>{patientSummaries.map((summary) => <article key={summary.patientId} style={{ borderTop: "1px solid #e3e9e7", padding: "12px 0" }}><p style={{ margin: 0, color: "#66757a", fontSize: 13 }}>{summary.displayLabel} · updated {new Date(summary.updatedAt).toLocaleString()}</p><h3>{summary.title}</h3><p>{summary.content}</p></article>)}</section> : <section style={panel}><h2 style={{ marginTop: 0 }}>Clinic access is awaiting approval</h2><p>{message ?? "A verified login is not a clinical permission."}</p><p style={{ marginBottom: 0 }}>Patient-facing summaries are a separate, explicitly provisioned view; no internal Care Note is exposed here.</p><button style={secondary} onClick={() => void refresh()}>Check again</button></section>;
  if (!selectedClinic) return null;

  return <section style={{ display: "grid", gap: 16, marginTop: 20 }}>
    <section style={{ ...panel, background: "#edf8f5" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}><div><strong>{selectedClinic.clinicName}</strong><p style={{ margin: "4px 0 0" }}>Active role: <strong>{selectedClinic.role}</strong> · synthetic demonstration data only · live updates via a content-free event signal, with 8-second refresh fallback</p></div><button style={secondary} onClick={() => void refresh()}>Refresh now</button></div></section>
    {patients.length > 1 && <section style={panel}><label><strong>Care Note</strong><select value={careNote?.patient.id ?? ""} onChange={(event) => { const patient = patients.find((item) => item.id === event.target.value); if (patient) void loadCareNote(selectedClinic, patient); }} style={{ marginLeft: 12 }}><option value="">Choose a patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.displayLabel}</option>)}</select></label></section>}
    {!careNote ? <section style={panel}><p style={{ margin: 0 }}>No Care Notes are available for this Clinic.</p></section> : <>
      <section style={panel}><p style={{ margin: 0, color: "#087f72", fontWeight: 700, letterSpacing: "0.06em" }}>CARE NOTE · {careNote.patient.displayLabel.toUpperCase()}</p><h2 style={{ marginBottom: 4 }}>What needs attention now</h2><p style={{ marginTop: 0 }}>Signals are sourced, not diagnoses or self-reported model confidence. A clinician decision is auditable and can affect only future reading order.</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>{careNote.highlights.map((highlight) => <article key={highlight.id} style={{ border: "1px solid #d6dedb", borderRadius: 12, padding: 16, background: highlight.status === "suggested" ? "#fff8df" : "#f7faf9" }}><p style={{ color: "#9a421e", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", marginTop: 0 }}>{highlight.status.toUpperCase()} · IMPORTANCE {highlight.importance}</p><h3 style={{ margin: "0 0 8px" }}>{highlight.title}</h3><p style={{ fontSize: 14 }}>{highlight.riskReason}</p><p style={{ color: "#087f72", fontSize: 14 }}>● {highlight.evidenceState}{highlight.learningBoost ? ` · +${highlight.learningBoost} bounded clinic feedback` : ""}</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button style={secondary} onClick={() => void showSource(highlight)}>View source in Timeline</button>{selectedClinic.role === "clinician" && highlight.status === "suggested" && <><button style={action} onClick={() => void reviewHighlight(highlight.id, "accepted")}>Accept</button><button style={secondary} onClick={() => void reviewHighlight(highlight.id, "rejected")}>Reject</button></>}</div></article>)}</div></section>
      {workbench && <section style={{ ...panel, borderColor: "#087f72" }}><p style={{ color: "#087f72", fontWeight: 700, marginTop: 0 }}>EVIDENCE WORKBENCH · TIMELINE SOURCE OPENED</p><h2 style={{ margin: "0 0 8px" }}>{workbench.title}</h2><p><strong>Exact source excerpt:</strong> “{workbench.sourceExcerpt}”</p><p style={{ fontSize: 14, marginBottom: 0 }}>Evidence state: {workbench.evidenceState} · Extraction: {workbench.extractionConfigVersion} · Span: {workbench.spanStart}–{workbench.spanEnd} · Rule: {workbench.ruleVersion}</p></section>}
      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(260px, 0.75fr)", gap: 16 }}>
        <section style={panel}><h2 style={{ marginTop: 0 }}>Longitudinal Timeline</h2>{careNote.entries.map((entry) => <article id={`entry-${entry.id}`} key={entry.id} style={{ borderTop: "1px solid #e3e9e7", padding: "12px 0", background: workbench?.sourceEntryId === entry.id ? "#f0faf7" : "transparent" }}><p style={{ margin: 0, color: "#66757a", fontSize: 13 }}>{label(entry.type)} · {entry.authorRole} · v{entry.currentVersion} · {new Date(entry.changedAt).toLocaleString()}</p><p style={{ margin: "6px 0" }}>{sourceMarkedContent(entry, workbench)}</p>{entry.provenancePointer && <p style={{ margin: "6px 0", fontSize: 13, color: "#087f72" }}>Source pointer: {entry.provenancePointer}</p>}<button style={secondary} onClick={() => void loadEntryCollaboration(entry)}>Discuss · history · audit</button></article>)}<div style={{ marginTop: 16 }}><label htmlFor="new-entry"><strong>Add a {selectedClinic.role === "staff" ? "staff" : "clinician"} Timeline Entry</strong></label><textarea id="new-entry" value={entryContent} onChange={(event) => setEntryContent(event.target.value)} style={input} maxLength={20_000} /><button style={action} onClick={() => void addEntry()}>Add immutable entry</button></div></section>
        <section style={panel}><h2 style={{ marginTop: 0 }}>Open actions</h2>{careNote.openTasks.map((task) => <article key={task.id} style={{ borderTop: "1px solid #e3e9e7", padding: "12px 0" }}><p style={{ margin: 0, fontWeight: 700 }}>{task.title}</p><p style={{ margin: "6px 0", fontSize: 14 }}>{task.reviewRequired ? "Review required" : "Follow-up"} · {task.status}</p>{task.status === "open" && <button style={action} onClick={() => void claimOrCloseTask(task)}>Claim</button>}{task.status === "claimed" && task.reviewRequired && selectedClinic.role === "clinician" && <button style={action} onClick={() => void claimOrCloseTask(task)}>Confirm & close</button>}</article>)}</section>
      </section>
      {activeEntry && <section style={{ ...panel, borderColor: "#087f72" }}><p style={{ color: "#087f72", fontWeight: 700, marginTop: 0 }}>COLLABORATION · {label(activeEntry.type)}</p><h2 style={{ marginTop: 0 }}>Discussion, edit history and revert</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}><div><h3>Threaded comments</h3>{comments.map((comment) => <article key={comment.id} style={{ borderTop: "1px solid #e3e9e7", padding: "10px 0" }}><p style={{ margin: 0 }}>{comment.body}</p><p style={{ fontSize: 13, color: "#66757a" }}>{comment.authorRole} · {comment.status}{comment.mentionedName ? ` · @${comment.mentionedName}` : ""}{comment.assigneeName ? ` · assigned to ${comment.assigneeName}` : ""}</p><button style={secondary} onClick={() => void setResolution(comment)}>{comment.status === "resolved" ? "Reopen" : "Resolve"}</button></article>)}<textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add a threaded comment. Mention and assignment safeguards are supported by the server workflow." style={input} maxLength={4_000} /><button style={action} onClick={() => void addComment()}>Add comment</button></div><div><h3>Versions and audit-safe revert</h3>{versions.map((version) => <article key={version.id} style={{ borderTop: "1px solid #e3e9e7", padding: "10px 0" }}><p style={{ margin: 0, fontWeight: 700 }}>Version {version.version} · {version.changedByRole}</p><p style={{ fontSize: 14, margin: "5px 0" }}>{version.content}</p>{version.version !== activeEntry.currentVersion && activeEntry.authorRole === selectedClinic.role && <button style={secondary} onClick={() => void revert(version)}>Restore as new version</button>}</article>)}{activeEntry.authorRole === selectedClinic.role && <><h3>Edit current section</h3><textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} style={input} maxLength={20_000} /><button style={action} onClick={() => void editEntry()}>Save new immutable version</button></>}</div></div></section>}
      <section style={panel}><h2 style={{ marginTop: 0 }}>Governed AI scribe intake</h2><p>For synthetic data only: direct identifiers are redacted before a source is persisted. The Timeline records a distinct <code>system</code> entry and an inspectable source pointer; it does not silently rewrite a clinical note.</p><select value={aiType} onChange={(event) => setAiType(event.target.value as typeof aiType)}><option value="ai_doctor_consult_summary">Doctor–patient consult summary</option><option value="ai_nurse_consult_summary">Nurse–patient consult summary</option><option value="ai_patient_session_summary">AI–patient session summary</option></select><textarea value={aiSource} onChange={(event) => setAiSource(event.target.value)} placeholder="Synthetic interaction text only" style={input} maxLength={20_000} /><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button style={action} onClick={() => void addAiSummary()}>Create governed AI draft</button><button style={secondary} onClick={() => void toggleVoiceCapture()}>{capturing ? "Stop local synthetic voice capture" : "Capture local synthetic voice"}</button></div></section>
      {selectedClinic.role !== "staff" && <section style={panel}><h2 style={{ marginTop: 0 }}>Patient-facing summary</h2><p>Only this explicitly published summary is eligible for a separately provisioned patient view; raw AI notes, internal comments and clinician/staff timeline remain excluded.</p><input value={summaryTitle} onChange={(event) => setSummaryTitle(event.target.value)} style={{ ...input, minHeight: 0 }} maxLength={160} /><textarea value={summaryContent} onChange={(event) => setSummaryContent(event.target.value)} placeholder="Plain-language instructions for the patient" style={input} maxLength={10_000} /><button style={action} onClick={() => void publishSummary()}>Publish patient-facing summary</button></section>}
    </>}
    {message && <p role="status" style={{ margin: 0, color: "#087f72", fontWeight: 700 }}>{message}</p>}
  </section>;
}
