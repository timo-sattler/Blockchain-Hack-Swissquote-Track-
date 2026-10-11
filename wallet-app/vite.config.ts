import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const wasmPath = path.join(path.dirname(require.resolve("@trustwallet/wallet-core/package.json")), "dist/lib/wallet-core.wasm");

// Serve Trust Wallet Core's wasm binary at /wallet-core.wasm (the emscripten loader fetches it
// relative to the page).
function walletCoreWasm(): Plugin {
  const serve = (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: Buffer) => void }) => {
    res.setHeader("Content-Type", "application/wasm");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(fs.readFileSync(wasmPath));
  };
  return {
    name: "wallet-core-wasm",
    configureServer(server) {
      server.middlewares.use("/wallet-core.wasm", serve as never);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/wallet-core.wasm", serve as never);
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "wallet-core.wasm", source: fs.readFileSync(wasmPath) });
    },
  };
}

const BANK_URL = process.env.BANK_URL || `http://localhost:${process.env.BANK_PORT || 4000}`;
const VAULT_URL = process.env.VAULT_URL || `http://localhost:${process.env.VAULT_PORT || 4100}`;
const PORT = Number(process.env.APP_PORT || 5173);

const proxy = {
  "/api": { target: BANK_URL },
  "/portal": { target: BANK_URL },
  "/vault": { target: VAULT_URL, rewrite: (p: string) => p.replace(/^\/vault/, "") },
};

export default defineConfig({
  plugins: [react(), walletCoreWasm()],
  resolve: {
    alias: [{ find: /^(fs|crypto|path|fs\/promises)$/, replacement: path.resolve(__dirname, "src/shims/node-empty.js") }],
  },
  // strictPort: a silent move to another port would leave people on an old tab of the app.
  server: { port: PORT, strictPort: true, proxy, allowedHosts: true },
  preview: { port: PORT, strictPort: true, proxy, allowedHosts: true },
  optimizeDeps: { include: ["@trustwallet/wallet-core"] },
  build: { chunkSizeWarningLimit: 20000, commonjsOptions: { transformMixedEsModules: true } },
});
