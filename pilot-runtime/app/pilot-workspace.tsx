"use client";

import { useCallback, useEffect, useState } from "react";

type Role = "staff" | "clinician" | "admin";
type Membership = { clinicId: string; clinicName: string; role: Role };
type Patient = { id: string; displayLabel: string };
type CareNote = {
  patient: { id: string; displayLabel: string; externalReference: string };
  entries: Array<{ id: string; type: string; authorRole: string; currentVersion: number; content: string; changedAt: string }>;
  highlights: Array<{ id: string; title: string; status: string; importance: number; riskReason: string; evidenceState: string; sourceEntryVersionId: string }>;
  openTasks: Array<{ id: string; title: string; status: string; reviewRequired: boolean; dueAt: string | null }>;
};
type Workbench = { highlight: { title: string; status: string; riskReason: string; importance: number }; claim: { evidenceState: string; entityType: string; normalizedValue: string; spanStart: number; spanEnd: number; extractionConfigVersion: string }; sourceExcerpt: string; sourceEntryVersionId: string };

const panel: React.CSSProperties = { border: "1px solid #d6dedb", borderRadius: 14, padding: 20, background: "#fff", boxShadow: "0 5px 16px rgba(21,36,43,0.05)" };
const action: React.CSSProperties = { border: 0, borderRadius: 7, padding: "9px 12px", fontWeight: 700, cursor: "pointer", background: "#087f72", color: "#fff" };
const secondary: React.CSSProperties = { ...action, background: "#e7f5f1", color: "#087f72" };

async function responseJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "REQUEST_FAILED");
  return payload as T;
}

export default function PilotWorkspace() {
  const [memberships, setMemberships] = useState<Membership[] | undefined>();
  const [selectedClinic, setSelectedClinic] = useState<Membership | undefined>();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [careNote, setCareNote] = useState<CareNote | undefined>();
  const [workbench, setWorkbench] = useState<Workbench | undefined>();
  const [entryContent, setEntryContent] = useState("");
  const [message, setMessage] = useState<string | undefined>();

  const loadCareNote = useCallback(async (clinic: Membership, patient: Patient) => {
    const result = await responseJson<CareNote>(`/api/patients/${patient.id}/care-note?clinicId=${encodeURIComponent(clinic.clinicId)}`);
    setCareNote(result);
  }, []);

  const loadClinic = useCallback(async (clinic: Membership) => {
    setSelectedClinic(clinic);
    setWorkbench(undefined);
    const directory = await responseJson<{ patients: Patient[] }>(`/api/clinics/${clinic.clinicId}/patients`);
    setPatients(directory.patients);
    if (directory.patients[0]) await loadCareNote(clinic, directory.patients[0]);
    else setCareNote(undefined);
  }, [loadCareNote]);

  const refresh = useCallback(async () => {
    setMessage(undefined);
    try {
      const result = await responseJson<{ memberships: Membership[] }>("/api/memberships");
      setMemberships(result.memberships);
      if (result.memberships[0]) await loadClinic(result.memberships[0]);
    } catch (error) {
      setMemberships([]);
      setMessage(error instanceof Error && error.message === "NOT_PROVISIONED" ? "Your verified identity has no active Clinic Membership yet." : "We could not load your Pilot access.");
    }
  }, [loadClinic]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function reviewHighlight(highlightId: string, decision: "accepted" | "rejected" | "pinned") {
    if (!selectedClinic || !careNote) return;
    try {
      await responseJson(`/api/highlights/${highlightId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, decision }) });
      await loadCareNote(selectedClinic, careNote.patient);
      setMessage("Review decision recorded with its audit trail.");
    } catch { setMessage("That review action is not permitted for this membership."); }
  }

  async function showSource(highlightId: string) {
    if (!selectedClinic) return;
    try {
      setWorkbench(await responseJson<Workbench>(`/api/highlights/${highlightId}?clinicId=${encodeURIComponent(selectedClinic.clinicId)}`));
    } catch { setMessage("The source evidence could not be loaded."); }
  }

  async function claimOrCloseTask(task: CareNote["openTasks"][number]) {
    if (!selectedClinic || !careNote) return;
    try {
      if (task.status === "open") {
        await responseJson(`/api/review-tasks/${task.id}/claim`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId }) });
        setMessage("Review task claimed.");
      } else if (task.reviewRequired && selectedClinic.role === "clinician") {
        await responseJson(`/api/review-tasks/${task.id}/close`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, reason: "clinician_confirmed" }) });
        setMessage("Review task closed with a clinician-confirmed decision.");
      }
      await loadCareNote(selectedClinic, careNote.patient);
    } catch { setMessage("The task state changed or this membership cannot complete that action."); }
  }

  async function addEntry() {
    if (!selectedClinic || !careNote || !entryContent.trim()) return;
    try {
      const type = selectedClinic.role === "staff" ? "staff_note" : "clinician_note";
      await responseJson("/api/care-entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clinicId: selectedClinic.clinicId, patientId: careNote.patient.id, type, content: entryContent }) });
      setEntryContent("");
      await loadCareNote(selectedClinic, careNote.patient);
      setMessage("New immutable Timeline Entry created.");
    } catch { setMessage("The entry could not be created for this membership."); }
  }

  if (!memberships) return <section style={panel}><p style={{ margin: 0 }}>Checking Clinic Memberships…</p></section>;
  if (!memberships.length) return <section style={panel}><h2 style={{ marginTop: 0 }}>Clinic access is awaiting approval</h2><p>{message ?? "A verified login is not a clinical permission."}</p><p style={{ marginBottom: 0 }}>For this synthetic local demo, a Pilot administrator must run the membership provisioning step before any Care Note is visible.</p><button style={secondary} onClick={() => void refresh()}>Check again</button></section>;
  if (!selectedClinic) return null;

  return (
    <section style={{ display: "grid", gap: 16, marginTop: 20 }}>
      <section style={{ ...panel, background: "#edf8f5" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div><strong>{selectedClinic.clinicName}</strong><p style={{ margin: "4px 0 0" }}>Active role: <strong>{selectedClinic.role}</strong> · synthetic demonstration data only</p></div>
          <button style={secondary} onClick={() => void refresh()}>Refresh access</button>
        </div>
      </section>
      {patients.length > 1 && <section style={panel}><label><strong>Care Note</strong><select value={careNote?.patient.id} onChange={(event) => { const patient = patients.find((item) => item.id === event.target.value); if (patient) void loadCareNote(selectedClinic, patient); }} style={{ marginLeft: 12 }}><option value="">Choose a patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.displayLabel}</option>)}</select></label></section>}
      {!careNote ? <section style={panel}><p style={{ margin: 0 }}>No Care Notes are available for this Clinic.</p></section> : <>
        <section style={panel}><p style={{ margin: 0, color: "#087f72", fontWeight: 700, letterSpacing: "0.06em" }}>CARE NOTE · {careNote.patient.displayLabel.toUpperCase()}</p><h2 style={{ marginBottom: 4 }}>What needs attention now</h2><p style={{ marginTop: 0 }}>Every signal below resolves to exact source evidence; none is a diagnosis or a model confidence score.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>{careNote.highlights.map((highlight) => <article key={highlight.id} style={{ border: "1px solid #d6dedb", borderRadius: 12, padding: 16, background: highlight.status === "suggested" ? "#fff8df" : "#f7faf9" }}><p style={{ color: "#9a421e", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", marginTop: 0 }}>{highlight.status.toUpperCase()} · IMPORTANCE {highlight.importance}</p><h3 style={{ margin: "0 0 8px" }}>{highlight.title}</h3><p style={{ fontSize: 14 }}>{highlight.riskReason}</p><p style={{ color: "#087f72", fontSize: 14 }}>● {highlight.evidenceState}</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button style={secondary} onClick={() => void showSource(highlight.id)}>View source</button>{selectedClinic.role === "clinician" && highlight.status === "suggested" && <><button style={action} onClick={() => void reviewHighlight(highlight.id, "accepted")}>Accept</button><button style={secondary} onClick={() => void reviewHighlight(highlight.id, "rejected")}>Reject</button></>}</div></article>)}</div>
        </section>
        {workbench && <section style={{ ...panel, borderColor: "#087f72" }}><p style={{ color: "#087f72", fontWeight: 700, marginTop: 0 }}>EVIDENCE WORKBENCH</p><h2 style={{ margin: "0 0 8px" }}>{workbench.highlight.title}</h2><p><strong>Exact source excerpt:</strong> “{workbench.sourceExcerpt}”</p><p style={{ fontSize: 14, marginBottom: 0 }}>Evidence state: {workbench.claim.evidenceState} · Extraction: {workbench.claim.extractionConfigVersion} · Span: {workbench.claim.spanStart}–{workbench.claim.spanEnd}</p></section>}
        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(260px, 0.75fr)", gap: 16 }}>
          <section style={panel}><h2 style={{ marginTop: 0 }}>Timeline</h2>{careNote.entries.map((entry) => <article key={entry.id} style={{ borderTop: "1px solid #e3e9e7", padding: "12px 0" }}><p style={{ margin: 0, color: "#66757a", fontSize: 13 }}>{entry.type.replaceAll("_", " ")} · v{entry.currentVersion}</p><p style={{ marginBottom: 0 }}>{entry.content}</p></article>)}<div style={{ marginTop: 16 }}><label htmlFor="new-entry"><strong>Add a {selectedClinic.role === "staff" ? "staff" : "clinician"} Timeline Entry</strong></label><textarea id="new-entry" value={entryContent} onChange={(event) => setEntryContent(event.target.value)} style={{ display: "block", boxSizing: "border-box", width: "100%", minHeight: 90, margin: "8px 0" }} maxLength={20000} /><button style={action} onClick={() => void addEntry()}>Add immutable entry</button></div></section>
          <section style={panel}><h2 style={{ marginTop: 0 }}>Open actions</h2>{careNote.openTasks.map((task) => <article key={task.id} style={{ borderTop: "1px solid #e3e9e7", padding: "12px 0" }}><p style={{ margin: 0, fontWeight: 700 }}>{task.title}</p><p style={{ margin: "6px 0", fontSize: 14 }}>{task.reviewRequired ? "Review required" : "Follow-up"} · {task.status}</p>{task.status === "open" && <button style={action} onClick={() => void claimOrCloseTask(task)}>Claim</button>}{task.status === "claimed" && task.reviewRequired && selectedClinic.role === "clinician" && <button style={action} onClick={() => void claimOrCloseTask(task)}>Confirm & close</button>}</article>)}</section>
        </section>
      </>}
      {message && <p role="status" style={{ margin: 0, color: "#087f72", fontWeight: 700 }}>{message}</p>}
    </section>
  );
}
