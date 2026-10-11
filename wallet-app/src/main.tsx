import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { core } from "./lib/walletcore";
import "./styles.css";

// Passkeys refuse IP addresses as their domain: http://127.0.0.1:5173 → http://localhost:5173.
if (location.hostname === "127.0.0.1" || location.hostname === "[::1]") {
  location.replace(location.href.replace(location.host, `localhost${location.port ? `:${location.port}` : ""}`));
} else {
  // Start loading the 10 MB wallet-core wasm right away.
  core().catch((e) => console.error("wallet-core failed to load", e));

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
