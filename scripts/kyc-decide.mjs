#!/usr/bin/env node
// KYC operator from the terminal: lists recoveries waiting for identity verification and
// approves or rejects one. Same API as the operator console at http://localhost:4000/portal/kyc.html.
//
//   npm run kyc                         list pending recoveries
//   npm run kyc -- approve [id]         approve (default: the most recent pending one)
//   npm run kyc -- reject [id] [note]
const BANK = process.env.BANK_URL || `http://localhost:${process.env.BANK_PORT || 4000}`;
const PIN = process.env.KYC_OPERATOR_PIN || "kyc-demo";
const [action, id, ...noteParts] = process.argv.slice(2);

async function call(path, { body, token } = {}) {
  const r = await fetch(BANK + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    console.error(`Bank server unreachable at ${BANK}. Start it with: npm run demo`);
    process.exit(1);
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`${path}: ${j.error || r.status}`);
    process.exit(1);
  }
  return j;
}

const { token } = await call("/api/operator/login", { body: { pin: PIN } });
const { recoveries } = await call("/api/operator/recoveries", { token });
const pending = recoveries.filter((r) => r.status === "pending_kyc");

if (!action) {
  if (!pending.length) console.log("No recovery is waiting for identity verification.");
  for (const r of pending) console.log(`${r.id}  ${r.clientId}  ${r.clientName}  from "${r.deviceLabel}"  ${r.createdAt}`);
  process.exit(0);
}
if (action !== "approve" && action !== "reject") {
  console.error("usage: npm run kyc -- [approve|reject] [recovery id] [note]");
  process.exit(1);
}
const target = id ? recoveries.find((r) => r.id === id) : pending[0];
if (!target) {
  console.error(id ? `Unknown recovery ${id}.` : "No recovery is waiting for identity verification.");
  process.exit(1);
}
const { recovery } = await call(`/api/operator/recoveries/${target.id}/decision`, {
  token,
  body: { decision: action, note: noteParts.join(" ") || `${action}d from the terminal` },
});
console.log(`${target.clientName} (${target.clientId}): recovery ${recovery.status}` + (recovery.secondsLeft != null ? `, share released in ${recovery.secondsLeft}s` : ""));
