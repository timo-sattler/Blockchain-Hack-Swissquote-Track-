# services/ — Swissquote share service, escrow agent and event hub

Three separate Node processes, each with its own storage. The share service and the escrow agent are **mocks of Swissquote's backend and of an independent notary**, labelled as such in the app and the pitch.

| Process | Port | Role | Storage |
|---------|-----:|------|---------|
| `share-service.mjs` | 8790 | **Swissquote's part (party 1 of 2).** Verifies the client's passkeys, decodes and screens every payment before co-signing, relays add-a-device copies it cannot read, sponsors USDC/EURC fees through the treasury (`treasury.mjs`). Never sends its part anywhere | `data/share-service/` |
| `escrow-agent.mjs` | 8791 | **Independent notary (mock).** Holds a copy of Swissquote's part; hands it to the client's device only after the grace period | `data/escrow-agent/` |
| `hub.mjs` | 8787 | Event hub for the live presentation; watches the share service's health and streams events over server-sent events | memory |

The hub is separate on purpose: stop the share service on stage and the presentation keeps running and shows Swissquote as offline.

## Run

From the repo root, `scripts/start-demo.sh` starts everything. By hand:

```bash
cd services
npm install
npm run hub      # terminal 1
npm run share    # terminal 2  (stop it = "Swissquote is gone")
npm run escrow   # terminal 3
npm test         # all tests
```

| Variable | Default | |
|----------|---------|---|
| `SHARE_PORT`, `ESCROW_PORT`, `HUB_PORT` | `8790`, `8791`, `8787` | |
| `SHARE_URL`, `ESCROW_URL`, `HUB_URL` | `http://localhost:<port>` | How the processes find each other |
| `DATA_DIR`, `ESCROW_DATA_DIR` | `data/share-service`, `data/escrow-agent` | Storage |
| `ESCROW_OUTAGE_SEC` | `30` | The grace period. Production: six months |
| `RELAYS_PER_DAY` | `10` | Sponsored USDC/EURC transfers per wallet per day (`0` disables sponsoring) |
| `RPC_URL` | `https://sepolia.base.org` | Base Sepolia RPC for the treasury |
| `STARTER_USDC`, `STARTER_ETH` | `20`, `0.0005` | Welcome bonus, sent only when the treasury holds enough |

Reset the presentation feed: `curl -X POST http://localhost:8787/reset`.

## Treasury (Swissquote's fee account)

On first start the share service creates the treasury key in its own storage (`data/share-service/treasury-key.json`, git-ignored) and prints the address; or set `TREASURY_PRIVATE_KEY`. It needs a little Base Sepolia ETH to pay the fees of gasless USDC/EURC transfers (`GET /treasury` shows the balance; `scripts/start-demo.sh` warns when it is empty). When it holds more than the welcome bonus, new wallets also receive `STARTER_USDC` + `STARTER_ETH`.

## Share service API

| Method + path | Purpose |
|---------------|---------|
| `POST /wallets` | Start a wallet: passkey registration options and a private `creationToken` |
| `POST /wallets/:id/passkey` | Verify and store the first device's passkey |
| `POST /wallets/:id/keygen/start`, `POST /mpc/:sid` | Two-party key generation; Swissquote is party 1 |
| `POST /wallets/:id/auth/options`, `POST /wallets/:id/login` | Passkey login (any registered device) → token bound to one transfer |
| `POST /login/options`, `POST /login` | Log in with a discoverable passkey (finds the wallet) |
| `POST /wallets/:id/sign/start`, `POST /mpc/:sid` | Co-signing: decodes the EVM transaction, EIP-3009 authorization or Bitcoin PSBT, screens the recipient, applies the high-value rule and signs **its own** hash |
| `POST /wallets/:id/relay` | Gasless USDC/EURC: submits the authorization approved in the same login; the treasury pays the fee |
| `POST /wallets/:id/devices/invite` | Logged-in device uploads its part, encrypted with a key that only travels in the link; 10-minute, single-use invite |
| `POST /wallets/:id/devices/options`, `.../devices/register` | The new device registers its own passkey and receives the encrypted copy |
| `POST /wallets/:id/devices/remove` | A lost device: its passkey is no longer accepted, its tokens are revoked |
| `POST /screen`, `GET /blocklist` | Recipient screening (emits `payment_blocked`); the mock list, which the app keeps a copy of |
| `GET /wallets/:id` | Public wallet info: addresses, devices |
| `GET /wallets/:id/parts` | Fingerprint and size of Swissquote's part (never the part), for *How my key works* |
| `GET /wallets`, `GET /treasury`, `GET /health` | Demo directory for the network graph, treasury status, liveness |

## Escrow agent API

| Method + path | Purpose |
|---------------|---------|
| `POST /deposit` | The share service deposits a copy of its part when a wallet is created (shared `ESCROW_DEPOSIT_TOKEN`) |
| `GET /wallets/:id` | Whether it holds a copy, its fingerprint, whether Swissquote is online, when the grace period ends |
| `POST /wallets/:id/takeover/start`, `POST /mpc/:sid` | After the grace period: the device co-signs a one-time challenge with the copy |
| `POST /wallets/:id/takeover/finish` | Checks that signature against the wallet's public key, returns the copy and deletes it |

## Tests and the custody proof

`npm test` runs 21 tests, with real WebAuthn verification and real DKLs MPC against the share service in its own process (disposable storage, random ports, a local RPC stub; no live wallets, no broadcasts):

- `tests/wallet-security.test.mjs`: creation token, single key generation, login replay, one login per transfer, screening before signing, adding devices (single-use invite, own passkey, encrypted copy only), removing devices (login refused, tokens revoked, never the last device), gasless gates, sponsorship cap for USDC and EURC.
- `tests/two-parts.test.mjs`: client part + Swissquote's part sign; Swissquote + the escrow copy, or + a forged client part, cannot; an identical copy on another device signs like the original.
- `tests/relay-quota.test.mjs`: the daily sponsoring cap holds under concurrency and restarts.

`npm run insider` (`-- <name> --scan`) runs the insider attack on the live database: Swissquote's stored part and the escrow copy try to sign a drain; every attempt fails. No secrets are printed.

## Events (hub)

`POST /events` with one JSON object; `GET /events` streams them. Types: `wallet_created`, `signing` (`parties: ["A","B"]`, `alone: true` after a takeover), `tx_broadcast`, `service_offline`, `service_online`, `funded`, `payment_blocked`, `device_added`, `device_removed`, `escrow_deposited`, `escrow_refused`, `takeover_released`. A = the client's part, B = Swissquote's part.

## License notice

Silence Laboratories' Silent Shard (`@silencelaboratories/dkls-wasm-ll-node`) is used under the Silence Laboratories Non-Commercial Use License. A production launch would need a commercial license.
