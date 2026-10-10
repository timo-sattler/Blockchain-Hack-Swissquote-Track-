# app/ — Wallet frontend

Self-custody wallet prototype: a passkey-owned ERC-4337 smart account on **Base Sepolia**, shown inside a mock-up of the Swissquote app.

## Swissquote app mock-up

The app opens as a look-alike of the Swissquote mobile app (Home, Trade, Bank, Plan) with a new **Crypto** tab in the bottom bar. Everything outside the Crypto tab is static demo data (marked *Demo data*) built from public marketing screenshots, without official logos. The Crypto tab shows:

- **Held by Swissquote** (mock): the crypto Swissquote holds for the client today, with a mocked *Move to my self-custody wallet* flow.
- **My self-custody wallet** (real): the passkey wallet described below, styled to match the app.

Code: `src/sq/` (tabs, icons, mock data, styles); `src/App.tsx` hosts the tab bar.

## What works today

- **Create:** Face ID / fingerprint creates a P-256 passkey in the device's secure element. Its public key is the owner of a smart account; the address is known immediately and the contract is deployed with the first transaction.
- **Sign & send:** USDC or ETH transfers are signed with the passkey and submitted as a UserOperation through a bundler. The explorer link is shown once the transaction is in a block.
- **Gasless (optional):** with `VITE_PAYMASTER_URL` set, a paymaster pays the gas, so the wallet only needs USDC.
- **Receive:** QR code and copy button for the wallet address.
- **Phone app:** installable on the home screen (PWA), full-screen with its own icon; see below.
- **Who controls this wallet:** reads the owners live from the smart account contract and shows that only the passkey is an owner, with a link to verify it on the explorer.
- **Mocked:** the Swissquote client session in the header and the 'from my Swissquote account' top-up (both marked `MOCK`).

Not yet: recovery (guardians + time-lock), the compliance co-signer, linking the wallet to the bank account.

## Run it

```bash
cd app
npm install
cp .env.example .env.local   # optional: add a paymaster URL for gasless transactions
npm run dev                  # http://localhost:5173
```

Passkeys need a secure context: `localhost` works in desktop Chrome, Edge and Safari. To test on a phone, deploy to an HTTPS host (see below).

> **Passkeys are bound to the domain they were created on.** A wallet created on `localhost:5173` cannot be opened on the Vercel URL, and vice versa. Each domain gives you a separate wallet.

### Try a transaction

1. Click **Create my wallet** and confirm the passkey prompt.
2. Fund the shown address on Base Sepolia (**Add funds** links to both faucets):
   - test USDC: https://faucet.circle.com
   - without a paymaster, also a little ETH for gas: https://portal.cdp.coinbase.com/products/faucet
3. Send a small amount to any address and open the explorer link.

To send to a teammate: they create their own wallet and share the address via **Receive → Copy address**. Receiving needs no funds and no deployed contract.

## Phone app (installable web app)

The wallet is a Progressive Web App: no app store needed. Opened over HTTPS on a phone, it can be added to the home screen and then runs full-screen with its own icon, like a native app. Face ID / fingerprint work as usual.

- **iPhone (Safari):** Share button → **Add to Home Screen**. The app shows this hint itself.
- **Android (Chrome):** tap **Install** in the app's banner, or browser menu → **Install app**.

Files: `public/manifest.webmanifest` (name, colours, icons), `public/sw.js` (offline shell; blockchain calls are never cached), `public/*.png` (icons), `src/components/InstallHint.tsx`.

## Deploy to Vercel

One-time setup by whoever owns the GitHub repo (Timo), because Vercel needs access to it:

1. Sign in at https://vercel.com with GitHub → **Add New… → Project** → import `Blockchain-Hack-Swissquote-Track-`.
2. **Root Directory:** `app`. Framework preset **Vite** is detected automatically (build `npm run build`, output `dist`).
3. Optional for gasless transfers: add the environment variable `VITE_PAYMASTER_URL`.
4. **Deploy.** Every push to `main` then updates the production URL (e.g. `https://<project>.vercel.app`).

Things to know:

- **Use the production URL for the demo.** Preview deployments get a new URL per deploy, and a passkey created on one URL does not work on the next.
- Preview deployments are protected by Vercel login by default. Teammates without a Vercel account can only open the production URL (or disable *Deployment Protection* in the project settings).
- `vercel.json` makes sure the service worker is never cached, so new deploys reach installed apps.

## Building blocks

| Part | Choice | Why |
|------|--------|-----|
| Smart account | [Coinbase Smart Wallet](https://github.com/coinbase/smart-wallet) v1.1, factory `0xba5ed110…85842` | Audited, built for passkey owners, already deployed on Base Sepolia, supports multiple owners (needed for recovery) |
| SDK | [viem](https://viem.sh) `account-abstraction` (`createWebAuthnCredential`, `toWebAuthnAccount`, `toCoinbaseSmartAccount`, `createBundlerClient`) | One dependency, no custom cryptography |
| Bundler | Pimlico public endpoint (default), EntryPoint v0.6 | Works without an API key, rate-limited |
| Paymaster | Any ERC-7677 paymaster URL, e.g. Pimlico with a free API key | Gasless transfers (bonus criterion) |
| Token | Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Official testnet USDC |

The passkey's public key and credential id are kept in `localStorage` so the app can rebuild the account. They are public data; the private key never leaves the authenticator. In production, Swissquote would store the public key with the client profile.

## Code map

- `src/config.ts`: chain, endpoints, token address
- `src/wallet.ts`: passkey creation, smart account, balances, on-chain owners, sending, error messages
- `src/App.tsx`: Swissquote-style shell with the bottom tab bar, toasts
- `src/sq/`: mocked Swissquote tabs (Home, Trade, Bank, Plan) and the Crypto tab
- `src/components/`: onboarding, wallet home, send / receive / add-funds sheets, control card, icons
- `src/lib/`: formatting and per-wallet activity history
