# app/ — Wallet frontend

Self-custody wallet prototype: a **2-of-3 MPC wallet** for Bitcoin testnet4 and Base Sepolia, shown inside a mock-up of the Swissquote app. One key, three shares: the phone (A), the Swissquote share service (B, a mocked separate process in [`services/`](../services/README.md)) and a recovery kit the client keeps (C). Any two sign; the whole key never exists anywhere.

## Swissquote app mock-up

The app opens as a look-alike of the Swissquote mobile app (Home, Trade, Bank, Plan) with a new **Crypto** tab in the bottom bar. Everything outside the Crypto tab is static demo data (marked *Demo data*) built from public marketing screenshots, without official logos. The Crypto tab is the real MPC self-custody wallet described below.

## What works today

All of this was tested end to end in Chrome with a virtual passkey authenticator against the real share service:

- **Create:** a passkey is registered with Swissquote, then phone, share service and kit run distributed key generation (Silence Labs Silent Shard, DKLs23). Share C is encrypted with a password (PBKDF2 + AES-GCM) and downloaded as the recovery kit.
- **Same key on every chain:** one public key gives a Bitcoin testnet address (P2WPKH) and an EVM address.
- **Send with Swissquote:** passkey login, then phone + share service sign. The service decodes the transaction itself, signs its own hash of it, refuses sanctioned recipients (mock list) and asks for an extra confirmation above 1,000 USDC.
- **Send without Swissquote:** if the service is unreachable, the app offers to sign with phone + recovery kit, entirely on the device.
- **Recovery:** on a new phone, the kit + a mocked identity check start a safety delay (30 s in the demo, 48 h in production). A non-matching selfie (attacker with phone + e-mail) is refused. After the delay a new passkey is registered, kit + Swissquote rebuild Share A, and the client saves a new kit. **Addresses stay the same**; the old phone share no longer works with Swissquote.
- **Live dashboard** at `/present.html` that shows all of this as it happens.

Funds are needed only for real broadcasts: test USDC and ETH for Base Sepolia, test BTC for testnet4 (**Add funds** links to the faucets).

**Prototype limitation:** Share A sits in `localStorage`. In production it would be encrypted with a key from the passkey (WebAuthn PRF) or kept in the platform keychain.

## Run it

```bash
# terminal 1 + 2: Swissquote share service and event hub (see services/README.md)
cd services && npm install && npm run hub
cd services && npm run share

# terminal 3: the app
cd app
npm install
npm run dev        # http://localhost:5173 (wallet) and /present.html (live dashboard)
```

The dev server proxies `/share` → share service (8790) and `/hub` → event hub (8787), so app, presentation and services share one origin.

Passkeys need a secure context: `http://localhost` or `https://`. An IP address over http does **not** work.

### Let others join (phones, team, projector): Cloudflare tunnel

```bash
# Windows: winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:5173
```

cloudflared prints a public `https://….trycloudflare.com` address. That one URL serves the wallet, the live dashboard (`/present.html`) and, through the proxy, both services. The dashboard shows it as a QR code bottom left.

- It works while your laptop and the three processes run.
- The address changes every time the tunnel restarts, and passkeys are bound to the address: start it once before the demo and keep it running.
- Some networks buffer the live event stream through the tunnel; the presentation then polls the hub every second automatically.

> **Passkeys are bound to the domain they were created on.** A wallet created on `localhost:5173` cannot be used on the Vercel URL, and vice versa.

### Demo script

1. Crypto tab → **Create my wallet** → passkey → save the recovery kit.
2. **Add funds** → faucets; then **Send** USDC on Base or BTC on testnet4. Watch `/present.html`.
3. Stop the share service (Ctrl+C) → **Send** again → *Sign with my recovery kit instead*.
4. **Remove wallet from this device** (lost phone) → *Lost your phone?* → kit → *Attacker* (refused) → again with *Take selfie as Anna* → wait → restore → same addresses.

## Phone app (installable web app)

The wallet is a Progressive Web App: no app store needed. Opened over HTTPS on a phone, it can be added to the home screen and then runs full-screen with its own icon.

- **iPhone (Safari):** Share button → **Add to Home Screen**. The app shows this hint itself.
- **Android (Chrome):** tap **Install** in the app's banner, or browser menu → **Install app**.

Files: `public/manifest.webmanifest`, `public/sw.js` (offline shell; blockchain calls are never cached), `public/*.png`, `src/components/InstallHint.tsx`.

## Deploy to Vercel

1. Sign in at https://vercel.com with GitHub → **Add New… → Project** → import `Blockchain-Hack-Swissquote-Track-`.
2. **Root Directory:** `app`. Framework preset **Vite** is detected automatically.
3. Environment variables: `VITE_SHARE_URL` and `VITE_HUB_URL` pointing to the services' public HTTPS addresses.
4. **Deploy.** Use the production URL for the demo: preview URLs change per deploy, and passkeys are bound to the URL.

Or from your own machine: `cd app && npx vercel --prod`.

## Building blocks

| Part | Choice |
|------|--------|
| Threshold signatures | [Silence Labs Silent Shard](https://www.npmjs.com/package/@silencelaboratories/dkls-wasm-ll-web) (DKLs23, WASM), non-commercial license |
| Passkeys | [SimpleWebAuthn](https://simplewebauthn.dev) (browser + server) |
| EVM | [viem](https://viem.sh): transaction building, Base Sepolia RPC |
| Bitcoin | [@scure/btc-signer](https://github.com/paulmillr/scure-btc-signer): SegWit transactions; mempool.space testnet4 API |
| Recovery kit encryption | WebCrypto PBKDF2-SHA256 (310,000 iterations) + AES-GCM |
| Token | Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Code map

- `src/mpc/`: MPC protocol client, share service API, chains (EVM + Bitcoin), recovery kit, phone storage, end-to-end flows
- `src/components/mpc/`: wallet UI (create, kit backup, home, send, recovery)
- `src/sq/`: mocked Swissquote tabs (Home, Trade, Bank, Plan) and the Crypto tab
- `src/present/`: live dashboard (network graph with key shares, activity feed)
- `src/App.tsx`: Swissquote-style shell with the bottom tab bar

## Live dashboard ()

One page for the projector:

- **Network graph:** every wallet around Swissquote with its USDC and ETH balance. Each client holds key shares **A** (phone) and **C** (recovery kit); Swissquote holds **B** of every wallet, drawn on the client's link. New wallets pop in, payments run as arrows from sender to recipient, welcome bonuses as green arrows. Co-signing lights up the B link, signing with the kit lights up the client, refused attacks turn the wallet red.
- **Activity feed:** events from the hub (badge **LIVE**) and transfers read straight from Base Sepolia and Bitcoin testnet4 (badge **ON-CHAIN**). On load the hub replays the session history.
- **Status:** event hub, share service (turns red when you stop it), treasury balance.
- **Reset:** clears the activity and payment arrows for every viewer. Wallets stay.
- **Bottom left:** QR code and link to the wallet app.
