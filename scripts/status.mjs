#!/usr/bin/env node
// Health of the running TrustWallet demo: bank server, share vault, wallet app, network and treasury.
const BANK = process.env.BANK_URL || `http://localhost:${process.env.BANK_PORT || 4000}`;
const VAULT = process.env.VAULT_URL || `http://localhost:${process.env.VAULT_PORT || 4100}`;
const APP = process.env.APP_URL || `http://localhost:${process.env.APP_PORT || 5173}`;

const get = (url) =>
  fetch(url, { signal: AbortSignal.timeout(5000) })
    .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) }))
    .catch(() => ({ ok: false }));
const line = (ok, name, detail) => console.log(`${ok ? "✓" : "✗"} ${name.padEnd(12)} ${detail}`);

const [config, vault, app] = await Promise.all([get(`${BANK}/api/public/config`), get(`${VAULT}/health`), get(APP)]);

line(config.ok, "bank", config.ok ? `${BANK}  (portal ${BANK}/portal/)` : `${BANK} unreachable`);
line(vault.ok, "vault", vault.ok ? `${VAULT}  ${vault.json?.shares ?? 0} share(s) on file` : `${VAULT} unreachable`);
line(app.ok, "wallet app", app.ok ? APP : `${APP} unreachable`);

if (config.ok) {
  const c = config.json;
  console.log(`  network    ${c.network.name} (chain ${c.chainId}) via ${c.rpcUrl}`);
  let balance = "?";
  try {
    const r = await fetch(`${BANK}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "eth_getBalance", params: [c.treasuryAddress, "latest"] }),
      signal: AbortSignal.timeout(8000),
    }).then((x) => x.json());
    if (r.result) balance = `${Number(BigInt(r.result)) / 1e18} ${c.network.symbol}`;
  } catch {}
  console.log(`  treasury   ${c.treasuryAddress}  balance ${balance}${c.treasuryTopup ? "" : "  (top-ups disabled)"}`);
  if (c.network.faucets?.length) console.log(`  faucets    ${c.network.faucets.join("  ")}`);
  console.log(`  time-lock  after a KYC-approved recovery, Swissquote's vault takes part after ${c.recoveryDelaySeconds}s`);
}
