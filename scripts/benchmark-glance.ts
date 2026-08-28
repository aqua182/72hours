export {};

const base = process.env.NIGHTINGALE_BASE_URL ?? "http://127.0.0.1:3000";
const role = await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "clinician" }) });
const cookie = role.headers.get("set-cookie");
if (!cookie) throw new Error("Could not establish clinician benchmark session");
const timings: number[] = [];
for (let i = 0; i < 100; i++) {
  const started = performance.now();
  const response = await fetch(`${base}/api/patients/patient-ava`, { headers: { cookie } });
  if (!response.ok) throw new Error(`Glance request failed: ${response.status}`);
  await response.arrayBuffer();
  timings.push(performance.now() - started);
}
timings.sort((a, b) => a - b);
console.log(JSON.stringify({ requests: 100, p50Ms: timings[49].toFixed(1), p95Ms: timings[94].toFixed(1), target: "≤ 300ms warm path" }, null, 2));
