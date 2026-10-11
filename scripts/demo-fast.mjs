#!/usr/bin/env node
// Same as `npm run demo`, with short time-locks for rehearsals and the browser test:
// recovery releases Swissquote's share after 15 s (production: 72 h) and a fraud freeze
// lasts 60 s (production: 7 days). Values already set in the environment win.
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  RECOVERY_DELAY_SECONDS: process.env.RECOVERY_DELAY_SECONDS || "15",
  FREEZE_SECONDS: process.env.FREEZE_SECONDS || "60",
};
console.log(`[demo:fast] recovery time-lock ${env.RECOVERY_DELAY_SECONDS}s, freeze ${env.FREEZE_SECONDS}s`);

const child = spawn("npm", ["run", "demo"], { stdio: "inherit", env, shell: process.platform === "win32" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
