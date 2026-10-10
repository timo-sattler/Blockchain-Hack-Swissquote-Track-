# Swissquote Wallet: self-custody with one key in two parts

A self-custody wallet Swissquote could launch for its clients: **their keys, their control**, inside the Swissquote app.

**In one minute.** One key, two parts, both needed for every payment. Your part is on your laptop, with identical copies on your other devices, each unlocked with its own Face ID. Swissquote holds the other part: it blocks payments to malicious addresses before anything is signed and pays the network fee for USDC and EURC, so going through Swissquote is safer and less pricey. Swissquote can never move your money alone. If Swissquote is ever gone, the wallet is paused, and after a six-month grace period an independent escrow agent hands its copy of Swissquote's part to your device.

The challenge: [`docs/challenge-brief.md`](docs/challenge-brief.md). The design: [`docs/custody-model.md`](docs/custody-model.md). No crypto background? [`docs/handbook.md`](docs/handbook.md).

## The demo story

| Brief | In the app |
|---|---|
| Create a wallet | Name → Face ID → the key is created in two parts with Swissquote. One public key gives a Bitcoin and an EVM address |
| Log in and sign a transaction | Face ID → Swissquote screens the recipient and co-signs → sent on Base Sepolia (USDC, EURC free) or Bitcoin testnet4 |
| (bonus) Compliance | A payment to a known scam or sanctioned address is refused before anything is signed |
| Lose the wallet or its keys | Laptop lost: on your phone, **Remove** it. Swissquote refuses its passkey; its copy of your part is useless |
| Recover access | New laptop: **Add a device** on the phone → scan the QR code → same wallet, same addresses. If Swissquote itself is gone: grace period, then **Take over my wallet** |

Run of show and talking points: [`pitch/README.md`](pitch/README.md).

## Run it

**Prerequisites:** Node.js **22.12 or newer**, npm, and a browser that supports passkeys (Chrome, Edge or Safari, with Face ID, a fingerprint, Windows Hello or a device PIN configured). The macOS / Linux scripts also require Bash, `curl` and `lsof`. Install `cloudflared` only if you want a public HTTPS link for phones; the manual steps below also work without the shell scripts.

Clone the repository and open a terminal in its root directory. On macOS / Linux:

```bash
./scripts/start-demo.sh
```

On a fresh clone, the script installs dependencies in both `services/` and `app/`, then starts the event hub, share service, escrow agent and Vite app. No API key or `.env` file is required for the default local setup. Open **http://localhost:5173**, select **Crypto**, then **Create my wallet**. The presentation is at **http://localhost:5173/present.html**.

Other commands, from the repository root:

```bash
./scripts/start-demo.sh --tunnel   # public HTTPS link; requires cloudflared
./scripts/stop-demo.sh             # stop processes on the demo ports; keep services/data/
./scripts/test-all.sh              # service tests, TypeScript checks and production build
```

The default ports are `5173` (app), `8787` (hub), `8790` (share service) and `8791` (escrow). The startup script reuses listeners already on those ports; it does not restart them or reload backend code. After changing service code or backend configuration, stop and restart the demo. Logs are in `.demo-logs/`.

If you pull changes to dependencies or switch branches, rerun the two `npm install --prefix ...` commands below; the startup script only installs when `node_modules/` is absent.

**Windows / manual startup:** install dependencies once, from the repository root:

```bash
npm install --prefix services
npm install --prefix app
```

Then open four terminals, each in the repository root:

| Terminal | Command |
|---|---|
| 1: event hub | `npm run hub --prefix services` |
| 2: share service | `npm run share --prefix services` |
| 3: escrow agent | `npm run escrow --prefix services` |
| 4: wallet app | `npm run dev --prefix app -- --port 5173 --strictPort` |

Keep the four terminals running. Stop each with Ctrl+C. Passkeys need `http://localhost` or `https://`; an HTTP LAN IP address does not work. For phones, use the HTTPS tunnel URL and create the wallet on that URL. Keep the same tunnel running: passkeys and wallet records are tied to its origin, so a wallet created on localhost or an older tunnel URL cannot simply log in on a new one.

**Fund the demo:** creation and device pairing work without funds. To send, use **Add funds** to obtain test USDC/EURC, ETH or Bitcoin testnet4 coins for the wallet. Sponsored USDC/EURC transfers also require **Base Sepolia ETH in the treasury**, a separate fee-paying account. The startup script prints its address and warns when it is empty; its status is at http://localhost:8790/treasury. Fund that address from a [Base Sepolia faucet](https://portal.cdp.coinbase.com/products/faucet). The welcome bonus is conditional on treasury funds; a new wallet can start with a zero balance.

**Rehearse losing a device:** first use **Add a device** to copy the client's key part to another device or browser profile. From that surviving device, remove the lost device and invite its replacement. A synced passkey alone does not restore a missing key part. The escrow takeover demo waits **30 seconds** after Swissquote becomes unreachable; six months is the proposed production grace period.

**Optional configuration:** copy `app/.env.example` to `app/.env.local` to change Vite's RPC or service URLs. Leave the service URL variables empty when using the local proxy. Backend settings such as `RPC_URL`, `TREASURY_PRIVATE_KEY` and `ESCROW_OUTAGE_SEC` must be exported in the shell that starts the services; the startup script and `npm run` commands do **not** automatically load the root `.env`. See [`services/README.md`](services/README.md) for settings.

**Reset a disposable demo:** stop the demo, delete `services/data/share-service/wallets/` and `services/data/escrow-agent/`, and clear the browser's site data. Keep `services/data/share-service/treasury-key.json` to retain the funded fee account. This deletes the demo wallets' key parts and device registrations.

## Repository

```
.
├── app/        Swissquote app mock-up with the wallet (Crypto tab) and the live presentation (/present.html)
├── services/   Share service (Swissquote's part), escrow agent, event hub, treasury; security tests
├── scripts/    start-demo.sh, stop-demo.sh, test-all.sh
├── docs/       Custody model, architecture, threat model, legal, business case, plain-language handbook
└── pitch/      Demo script and AI tools used
```

## Judging criteria → where it lives

| Criterion | Points | Where |
|---|---:|---|
| Technical implementation | 35 | `app/src/mpc/`, `services/`, [`docs/architecture.md`](docs/architecture.md) |
| Security & custody | 20 | [`docs/custody-model.md`](docs/custody-model.md), [`docs/threat-model.md`](docs/threat-model.md), `services/tests/` |
| Legal & compliance | 15 | [`docs/legal-compliance.md`](docs/legal-compliance.md) |
| Business case | 15 | [`docs/business-case.md`](docs/business-case.md) |
| UX & pitch | 15 | the app, `/present.html`, [`pitch/README.md`](pitch/README.md) |
| Bonus | +20 | Gasless USDC and EURC (EIP-3009 relay); screening of every payment against malicious addresses |

## Real vs. mocked

| Part | State |
|---|---|
| Two-party key generation and signing (DKLs23), Face ID passkeys, devices with identical copies | **Real** |
| Transactions on Base Sepolia (USDC, EURC, ETH) and Bitcoin testnet4; gasless USDC/EURC relay | **Real** (testnets) |
| Screening logic, high-value confirmation, sponsorship limits | **Real** code; the list of malicious addresses is a **mock** |
| Swissquote's backend, escrow agent | **Mock** processes with their own storage (separate processes, as the brief requires) |
| Swissquote app around the Crypto tab, client login and KYC | **Mock** (static demo data) |

## Tests

`scripts/test-all.sh` runs 21 service tests (real MPC and WebAuthn against the share service in its own process) and the app build. They include the custody proof: Swissquote's part alone, with the escrow copy, or with a forged client part cannot sign. `cd services && npm run insider` runs the same attack on the live database.

## Team

| Person | Focus |
|---|---|
| Vincent | |
| Maxi | |
| Grace | |
| Jeroen | |
| Timo | |

## Workflow

Never push directly to `main`: work on a branch (`<name>/<task>`), push it, open a pull request, one teammate reviews, merge. Keep secrets (private keys, API keys) in ignored environment files or shell variables; `.env.example` documents sample settings. See the loading rules above. **Never commit real keys.**
