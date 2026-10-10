# AI tools used

Required in the submission. Add a line whenever you use an AI tool.

| Tool | Used for | By |
|------|----------|----|
| Claude | Repo structure, weekend plan, custody/recovery design drafts, Mermaid diagrams | Timo |
| Claude (Claude Code) | Smart-account recovery module with Foundry tests and deployment (branch `grace/recovery-multicoin`); the three-part MPC design's recovery features (branch `grace/mpc-docs`); the two-part model on this branch: 2-of-2 key generation, adding and removing devices, grace period and escrow takeover, screening, gasless USDC/EURC, *How my key works*, the custody-proof tests and insider script; headless browser end-to-end tests with virtual passkeys; the documentation and the plain-language handbook | Grace |
| ChatGPT | Recovery authorization and passkey hardening in the share service, with the security tests that the two-part suite (`services/tests/wallet-security.test.mjs`) is based on | Grace |
