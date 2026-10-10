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
| `POST /wallets/:id/kit/replace` | Kit lost or stolen: passkey login → `kitReplaceToken`; phone + Swissquote then re-issue all shares (lost party = kit), so the old kit stops working |
| `POST /wallets/:id/relay` | Gasless USDC: submits the EIP-3009 authorization approved in the same login; the treasury pays the fee; `RELAYS_PER_DAY` per wallet |
| `POST /wallets/:id/recovery/cancel` | **Owner veto.** Needs a passkey login token: the current passkey stops a recovery until the MPC recovery successfully commits, including after a new passkey is staged |
| `POST /wallets/:id/passkey/options` | New passkey registration once the delay is over |
| `GET /wallets/:id`, `GET /health` | Public wallet info (incl. `epoch` and `recovery.canCancel`), liveness |
| `GET /wallets` | Demo directory: names + public addresses of all wallets (for the live network graph) |
| `GET /treasury` | Treasury address, balances, wallets it can still fund |
| `POST /screen` | Screens a recipient before a payment is built (every path, also phone + kit); a match returns `{ blocked: true, reason }` and emits `payment_blocked` |
| `GET /blocklist` | The mock blocklist; the app keeps a copy so kit payments are screened while Swissquote is offline |
| `POST /wallets/:id/backup/inbox` | On-chain backup: a friend's inbox key, signed by their wallet (phone + Swissquote, `sign/start` with `chain: 'backup'`) in the same login; the treasury submits it |
| `POST /wallets/:id/backup/create` | On-chain backup: the client's signed backup, encrypted pieces and kit chunks; checked against the signed hashes, then submitted by the treasury |
| `POST /backup/return` | A friend gives a piece back, encrypted to the recovering phone's one-time key; no login, rate-limited, capped per request by the contract |

On-chain backup: contract `contracts/src/KitBackupMailbox.sol`, address in `backup-mailbox.mjs` (override with `BACKUP_MAILBOX`). Deploy a new one with `cd contracts && forge build && cd ../services && node deploy-mailbox.mjs` (uses the testnet deployer key from `../.env`). Design: [`docs/onchain-backup.md`](../docs/onchain-backup.md).

## Escrow agent (mock, third process)

```bash
npm run escrow   # terminal 3, port 8791, storage data/escrow-agent/
```

After every key generation the share service deposits a copy of Share B (`ESCROW_URL`, shared `ESCROW_DEPOSIT_TOKEN`). The agent only joins a lost-share recovery after the share service has been unreachable for `ESCROW_OUTAGE_SEC` (default 20) and the client passes its identity check (mock); it deletes its copy afterwards. The app reaches it through the dev-server proxy at `/escrow`.

## Replaced devices (share epoch)

Recovery and device pairing issue new shares for all three parties (same key, same addresses). The service
keeps an `epoch` per wallet and bumps it each time. The phone stores the epoch of its share and sends it
with every co-sign request: an older epoch gets `409` ("This phone was replaced…") and the app shows the
old phone a lockout card. Limit: an old phone share and the *old* kit file still form a valid pair offline,
so the client should delete the old kit after a recovery (the app says so).

## Event format (hub)

`POST /events` with one JSON object; `GET /events` streams them. Types: `wallet_created`, `funded`, `device_paired`, `signing` (`parties: ["A","B"]` or `["A","C"]`), `tx_broadcast`, `service_offline`, `service_online`, `recovery_requested` (`by: client|attacker`), `recovery_refused`, `recovery_completed`, `recovery_cancelled`, `replaced_device_refused`. A = phone, B = Swissquote, C = recovery kit.

## License notice

The share service uses Silence Laboratories' Silent Shard (`@silencelaboratories/dkls-wasm-ll-node`) under the Silence Laboratories Non-Commercial Use License. A production launch would need a commercial license.

## Recovery and authentication security checks

Run `node --test tests/*.test.mjs` from `services/`. Recovery tests use real WebAuthn verification and DKLs signing against a separate process with disposable storage, random local ports and a local RPC stub. They do not use live demo wallets or broadcast to a blockchain.

- Creation returns a private `creationToken`, required for passkey registration and key generation.
- Passkey authentication options return a `challengeId`, required on login. Challenges expire and are single-use. A signing token is bound to one approved transaction or Bitcoin PSBT.
- `POST /wallets/:id/recovery/proof/start` returns a fixed random challenge for kit + bank signing. `recovery/request` requires its `proofId` and compact signature, then returns a private `recoveryToken`.
- The recovering device passes `recoveryToken` to registration and key generation. Registering stages the replacement credential; successful MPC completion activates it. The owner can cancel until that commit.
- Device pairing returns `pairingToken`, required when starting its key generation.
- Gasless relay accepts only an authorization approved in the same passkey session. The daily allowance is persisted and reserved before RPC work; sponsored attempts, including failures, count toward the cap. Duplicate authorization nonces are refused.
