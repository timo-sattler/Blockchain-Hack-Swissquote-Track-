#!/usr/bin/env node
// Opens a Cloudflare quick tunnel to the app (https, needed for passkeys on a phone) and writes its
// address to bank-server/data/phone-url.txt while it runs. "Add a device" on http://localhost then
// puts that https address in the QR code, because a phone can't open the computer's localhost.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.resolve(process.env.BANK_DATA_DIR || path.join(root, "bank-server/data"), "phone-url.txt");
const port = process.env.APP_PORT || 5173;

const child = spawn("npx", ["--yes", "cloudflared", "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://localhost:${port}`], {
  stdio: ["ignore", "pipe", "pipe"],
});

let found = false;
const watch = (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  const m = !found && /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text);
  if (!m) return;
  found = true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, m[0] + "\n");
  console.log(`\n  Open on your iPhone (Safari):  ${m[0]}\n  "Add a device" QR codes made on http://localhost now point here. Keep this running.\n`);
};
child.stdout.on("data", watch);
child.stderr.on("data", watch);

const cleanup = () => fs.rmSync(file, { force: true });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
