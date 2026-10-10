# services/ — Swissquote share service and event hub

Two separate Node processes. Both are **mocks of Swissquote's backend**, labelled as such in the app and the pitch.

| Process | Port | Role | Storage |
|---------|-----:|------|---------|
| `share-service.mjs` | 8790 | **MPC party B.** Holds Share B, verifies the client's passkey, decodes and checks every transaction before co-signing (mock sanctions list, extra confirmation above 1,000 USDC), runs recovery (mock re-KYC + delay). Never sends Share B anywhere. | `data/share-service/wallets/*.json` (own folder) |
| `hub.mjs` | 8787 | Event hub for the live presentation. Receives events from the share service and the app, watches the share service's health, streams everything to `/present` over server-sent events. | memory |

The hub is separate on purpose: you can kill the share service on stage and the presentation keeps running and shows Swissquote as offline.

## Run

```bash
cd services
npm install
npm run hub      # terminal 1
npm run share    # terminal 2  (Ctrl+C here = "Swissquote is gone")
```

Then start the app (`cd app && npm run dev`) and open `http://localhost:5173` (wallet, Crypto tab) and `http://localhost:5173/present.html#live` (presentation).

Environment variables:

| Variable | Default | |
|----------|---------|---|
| `RECOVERY_DELAY_SEC` | `30` | Recovery safety delay. Production would be 48 h. |
| `SHARE_PORT`, `HUB_PORT` | `8790`, `8787` | |
| `HUB_URL`, `SHARE_URL` | `http://localhost:8787`, `http://localhost:8790` | How the two processes find each other |
| `DATA_DIR` | `services/data/share-service` | Share service storage |
| `PUBLIC_URL` (hub) | – | Public address of the demo (e.g. the Cloudflare tunnel). The dashboard's QR code uses it, so phones can join even when the dashboard runs on localhost. |
| `PAIRING_DELAY_SEC` | `10` | Safety delay before a new device (passkey + kit) gets its share. Production would be ~24 h. |

Reset the presentation feed: `curl -X POST http://localhost:8787/reset`.

## Welcome bonus (treasury, mock)

Every new wallet automatically gets test funds from a Swissquote treasury account on Base Sepolia (`treasury.mjs`): by default **20 USDC + 0.0005 ETH** for gas. In production this would be Swissquote sponsoring its clients' gas, not a cash gift.

- On first start the share service creates the treasury key in its own storage (`data/share-service/treasury-key.json`, git-ignored) and prints the treasury address. Or set `TREASURY_PRIVATE_KEY`.
- **Fund the treasury** from faucets: test USDC at https://faucet.circle.com (Base Sepolia), ETH from a Base Sepolia faucet. `GET /treasury` shows its balance and how many wallets it can still fund.
- If the treasury runs low it sends gas only, or nothing, and logs a warning. The wallet still works; the client can use **Add funds**.
- Amounts: `STARTER_USDC`, `STARTER_ETH`.

## Share service API

| Method + path | Purpose |
|---------------|---------|
| `POST /wallets` | Start a wallet: passkey registration options |
| `POST /wallets/:id/passkey` | Verify and store the passkey (also used for the new phone after recovery) |
| `POST /wallets/:id/keygen/start`, `POST /mpc/:sid` | Distributed key generation or lost-share recovery, Swissquote = party 1 |
| `POST /wallets/:id/auth/options`, `POST /wallets/:id/login` | Passkey login → short-lived token |
| `POST /wallets/:id/sign/start`, `POST /mpc/:sid` | Co-signing: the service decodes the EVM transaction or Bitcoin PSBT, applies policy, and signs **its own** hash of it |
| `POST /wallets/:id/recovery/request` | Mock re-KYC; refuses a non-matching selfie, otherwise starts the delay |
| `POST /wallets/:id/passkey/options` | New passkey registration once the delay is over |
| `GET /wallets/:id`, `GET /health` | Public wallet info, liveness |
| `GET /wallets` | Demo directory: names + public addresses of all wallets (for the live network graph) |
| `GET /treasury` | Treasury address, balances, wallets it can still fund |

## Event format (hub)

`POST /events` with one JSON object; `GET /events` streams them. Types: `wallet_created`, `funded`, `device_paired`, `signing` (`parties: ["A","B"]` or `["A","C"]`), `tx_broadcast`, `service_offline`, `service_online`, `recovery_requested` (`by: client|attacker`), `recovery_refused`, `recovery_completed`. A = phone, B = Swissquote, C = recovery kit.

## License notice

The share service uses Silence Laboratories' Silent Shard (`@silencelaboratories/dkls-wasm-ll-node`) under the Silence Laboratories Non-Commercial Use License. A production launch would need a commercial license.
