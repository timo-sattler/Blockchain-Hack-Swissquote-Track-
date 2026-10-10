# app/ — Wallet frontend

The two-part self-custody wallet (Bitcoin testnet4 and Base Sepolia), shown inside a mock-up of the Swissquote app, plus the live presentation. One key in two parts: the client's part on their devices and Swissquote's part in the share service ([`services/`](../services/README.md), a mocked separate process). Both sign together; the whole key never exists anywhere.

## What you see

The app opens as a look-alike of the Swissquote mobile app (Home, Trade, Bank, Plan: static demo data, without official logos) with a **Crypto** tab that holds the real wallet:

- **Create:** name → Face ID → two-party key generation with Swissquote.
- **Balance card:** USDC, EURC, BTC and ETH; *Send*, *Receive* (with *The same key on other networks*), *Add funds* (faucet links).
- **Send:** USDC, EURC, ETH or BTC. USDC and EURC are free (Swissquote pays the fee). Every recipient is screened; a scam address shows **Blocked by Swissquote**. A labelled *Demo: use a known scam address* button fills one in.
- **Your key: two parts:** the devices that hold the client's part (with *Remove*), Swissquote's status, **Add a device** (QR code / link), and **How my key works** (fingerprints of the parts and the messages of the last signature).
- **Paused / takeover:** if Swissquote is unreachable, a banner explains the pause and counts down the grace period; then **Take over my wallet**.
- **Remove wallet from this device:** simulates a lost device.

## Run it

From the repo root: `scripts/start-demo.sh` (or `--tunnel` for phones). By hand:

```bash
cd services && npm install && npm run hub      # terminal 1
cd services && npm run share                   # terminal 2
cd services && npm run escrow                  # terminal 3
cd app && npm install && npm run dev           # terminal 4 → http://localhost:5173 and /present.html
```

The dev server proxies `/share`, `/escrow` and `/hub` to the services (ports from `SHARE_PORT`, `ESCROW_PORT`, `HUB_PORT`), so the app, the presentation and the services share one origin. Passkeys need a secure context: `http://localhost` or `https://`, never an IP address. Passkeys are bound to the address: a wallet created on `localhost` does not work on a tunnel URL, and vice versa.

**Phones, teammates, projector:** `scripts/start-demo.sh --tunnel` starts a Cloudflare quick tunnel and prints a public `https://….trycloudflare.com` link that serves everything. Keep it running: a new tunnel gets a new address.

**Installable app:** opened over HTTPS on a phone, the wallet can be added to the home screen (iPhone: Share → *Add to Home Screen*; Android: *Install app*). Files: `public/manifest.webmanifest`, `public/sw.js` (offline shell; blockchain calls are never cached), `src/components/InstallHint.tsx`.

## Code map

| Path | Content |
|---|---|
| `src/mpc/protocol.ts` | MPC client: two-party key generation, signing with Swissquote (or the escrow agent), signing on the device after a takeover; message transcript |
| `src/mpc/flows.ts` | Create, log in, send, add / remove devices, take over, part fingerprints |
| `src/mpc/chains.ts` | EVM (viem) and Bitcoin (@scure/btc-signer) transactions, EIP-3009 authorizations, balances |
| `src/mpc/networks.ts` | Addresses of the same key on other networks (EVM, Litecoin, Dogecoin, Tron) |
| `src/mpc/screening.ts` | Recipient screening, with a copy of the list for after a takeover |
| `src/mpc/store.ts`, `api.ts` | The device's own data; HTTP to the share service, escrow agent and hub |
| `src/components/mpc/` | Wallet screens: home, send, key parts card, add / join device, key inspector |
| `src/sq/` | Mocked Swissquote tabs |
| `src/present/` | Live presentation: slides, live architecture, activity feed, network graph, rehearsal run |

## Live presentation (`/present.html`)

Keys: → / Space next, ← back, `f` full screen, `s` simulated run (rehearsal fallback, marked **SIMULATED**), `c` clear the feed. Events come from the hub (badge **LIVE**); transfers of known wallets are read from the chains (badge **ON-CHAIN**). The hub replays the session history on load.

## Environment

Optional, in `app/.env.local` (see `.env.example`): `VITE_RPC_URL`, `VITE_SHARE_URL`, `VITE_ESCROW_URL`, `VITE_HUB_URL` (only when the services run elsewhere), `VITE_MEMPOOL_API`.
