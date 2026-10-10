# Blockchain Hack — Swissquote Track: Wallet Challenge

A self-custody wallet Swissquote could realistically launch for its clients: **their keys, their control**, while staying one step away from their Swissquote account.

The demo must cover the full lifecycle **create → authenticate → sign & send (testnet) → lose access → recover**.

Full challenge text: [`docs/challenge-brief.md`](docs/challenge-brief.md)

**In one minute:** one key, three parts, any two sign. One part is at Swissquote, one on your phone or laptop (unlocked with Face ID / Touch ID), one on a USB stick (your recovery kit, locked with a password). Paying through Swissquote is **safer and free**: it blocks malicious addresses before anything is signed and pays the USDC network fee. But it can never move your money, and never lock you out: if it disappears, device + USB still sign.

## Run it

macOS / Linux, from the repo root:

```bash
scripts/start-demo.sh            # hub, share service, escrow agent, app → http://localhost:5173
scripts/start-demo.sh --tunnel   # plus a public https link for phones and the projector (needs cloudflared)
scripts/stop-demo.sh             # stop everything (wallet data in services/data/ is kept)
scripts/test-all.sh              # contract tests, service security tests, app build
```

Parts that already run are left alone, logs go to `.demo-logs/`, and the start script warns if Swissquote's treasury has no testnet ETH (needed for free USDC transfers and the on-chain backup; [faucet](https://portal.cdp.coinbase.com/products/faucet)). Demo script: [`pitch/README.md`](pitch/README.md).

Windows, or by hand: `cd services && npm install`, then `npm run hub`, `npm run share` and `npm run escrow` in three terminals; `cd app && npm install && npm run dev` in a fourth. Passkeys need `http://localhost` or `https://`, never an IP address.

**Start from scratch:** stop the demo, delete `services/data/share-service/wallets/` and `services/data/escrow-agent/` (keep `treasury-key.json`: it is the funded treasury), and clear the site data in the browser.

## Team

| Person  | Focus area (to be agreed) |
|---------|---------------------------|
| Vincent | TBD |
| Maxi    | TBD |
| Grace   | TBD |
| Jeroen  | TBD |
| Timo    | TBD |

## Repository structure

```
.
├── app/         Swissquote app mock-up with the MPC wallet (Crypto tab) and the live presentation (/present.html)
├── services/    Swissquote share service (MPC party B, mock, own process + storage) and the event hub
├── spikes/      MPC library spike (Silence Labs DKLs23)
├── docs/        Custody model, threat model, architecture, recovery, legal, business case, plain-language handbook
├── contracts/   KitBackupMailbox: on-chain backup of the recovery kit between friends (Base Sepolia, Foundry tests)
├── pitch/       Slides, demo script, AI tools used
└── members/     Personal scratch folder per team member
```

Each folder has its own README describing what belongs there.

## Judging criteria → where it lives

| Criterion | Points | Main location |
|-----------|-------:|---------------|
| Technical implementation | 35 | `app/`, `services/` |
| Security & custody design | 20 | `docs/custody-model.md`, `docs/threat-model.md`, `docs/recovery.md` |
| Legal feasibility | 15 | `docs/legal-compliance.md` |
| Business case | 15 | `docs/business-case.md` |
| UX & pitch | 15 | `app/`, `pitch/` |
| Bonus: compliant interaction | +10 | `services/share-service.mjs`: transaction decoding, sanctions screening, high-value confirmation |
| Bonus: gasless tx | +10 | Gasless USDC via EIP-3009, relayed by Swissquote with a daily quota: `services/share-service.mjs` (`/relay`), `services/treasury.mjs` |

Bonus points only count if the core create → sign → recover flow works end to end, so that comes first.

**New to crypto?** Start with [`docs/handbook.md`](docs/handbook.md): every idea explained without jargon.

### Submission checklist (from the brief)

| The brief asks for | Where |
|---|---|
| Custody model decision and threat model | [`docs/custody-model.md`](docs/custody-model.md), [`docs/threat-model.md`](docs/threat-model.md), [`docs/security.md`](docs/security.md) |
| Architecture diagram, mocked parts marked | [`docs/architecture.md`](docs/architecture.md) |
| Custody and the Travel Rule | [`docs/legal-compliance.md`](docs/legal-compliance.md) |
| How Swissquote makes money from it | [`docs/business-case.md`](docs/business-case.md) |
| Recovery, incl. attacker with stolen phone + e-mail | [`docs/recovery.md`](docs/recovery.md) |
| Bonus topics tackled | Gasless USDC (EIP-3009 relay); compliant interaction (decoding, sanctions screening, high-value confirmation) |
| AI tools used | [`pitch/ai-tools.md`](pitch/ai-tools.md) |

## Workflow

1. **Never push directly to `main`.** Create a branch per task:
   ```
   git checkout main && git pull
   git checkout -b <name>/<short-task>     # e.g. grace/passkey-login
   ```
2. Commit small and often, then push your branch:
   ```
   git push -u origin <name>/<short-task>
   ```
3. Open a Pull Request on GitHub; one teammate reviews, then merge.
4. Pull `main` regularly to stay in sync.

Secrets (private keys, API keys, RPC URLs) go into `.env` (git-ignored). Copy `.env.example` to `.env` and fill it in. **Never commit real keys.**
