# AI tools used

Required in the submission. Add a line whenever you use an AI tool.

| Tool | Used for | By |
|------|----------|----|
| Claude | Repo structure, weekend plan, custody/recovery design drafts, Mermaid diagrams | Timo |
| Claude (Claude Code) | Earlier designs: smart-account recovery module with Foundry tests and deployment (branch `grace/recovery-multicoin`); the three-part MPC design's recovery features (branch `grace/mpc-docs`); the two-part model: 2-of-2 key generation, adding and removing devices, grace period and escrow takeover, screening, gasless USDC/EURC, *How my key works*, the custody-proof tests and insider script; headless browser end-to-end tests with virtual passkeys; the documentation and the plain-language handbook | Grace |
| ChatGPT | Earlier design: recovery authorization and passkey hardening in the share service, with the security tests the two-part suite was based on | Grace |
| Claude (Claude Code) | Current app (branch `grace/simple-model`): merging the Trust Wallet Core wallet with the 2-of-3 MPC key (device, vault, paper Recovery Card), recovery with key refresh, KYC console and time-lock safeguards, gasless USDC/EURC, compliant dApp interaction (approved list, dry run, plain-language effects), the Swissquote-style dark UI and iPhone web app, API and browser end-to-end tests, the documents in `docs/`, `GUIDE.md` and the technical slides in `pitch/tech/` | Grace |
