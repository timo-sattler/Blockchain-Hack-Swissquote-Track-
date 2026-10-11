#!/usr/bin/env node
// Resets the TrustWallet demo to its seeded state: deletes the bank's client database and the
// vault's shares and notary escrow copy. Keeps bank-server/data/treasury.json so the funded
// treasury key survives. Stop the demo first: running servers would write their memory back.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  path.resolve(process.env.BANK_DATA_DIR || path.join(root, "bank-server/data"), "bank.json"),
  path.resolve(process.env.VAULT_DATA_DIR || path.join(root, "share-vault/data"), "vault.json"),
  path.resolve(process.env.VAULT_DATA_DIR || path.join(root, "share-vault/data"), "notary-escrow.json"),
];

const up = await Promise.all(
  [process.env.BANK_PORT || 4000, process.env.VAULT_PORT || 4100].map((p) =>
    fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1000) }).then(() => p, () => null)
  )
);
if (up.some(Boolean)) {
  console.error(`Something is still listening on port ${up.filter(Boolean).join(", ")}. Stop the demo (Ctrl+C) first.`);
  process.exit(1);
}
for (const f of files) {
  if (fs.existsSync(f)) {
    fs.rmSync(f);
    console.log(`deleted ${path.relative(root, f)}`);
  }
}
console.log("Demo data reset. Clear the browser's site data for the app too, then run: npm run demo");
