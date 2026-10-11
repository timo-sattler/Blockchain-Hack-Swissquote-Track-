# Architecture

![Architecture: app, Swissquote bank, share vault, notary, Ethereum, Recovery Card](img/architecture.png)

Source: [`img/architecture.svg`](img/architecture.svg). Green = real code paths, amber = mocked Swissquote infrastructure.

## Components

| Component | Code | Real or mock | Role | Stores |
|---|---|---|---|---|
| **Wallet app** | `wallet-app/` (React, TypeScript, Vite; installable web app for iPhone) | **Real** | MPC party 0 (DKLs23 in WebAssembly), Trust Wallet Core (WebAssembly) for every transaction, passkeys (WebAuthn + PRF), WebCrypto for the encrypted parts | Encrypted Part A, encrypted Part C, public profile (browser storage) |
| **Swissquote bank** | `bank-server/` (Node.js, Express, SimpleWebAuthn, ethers), port 4000 | **Mock** of Swissquote's backend | Client login (password + SMS), passkey checks, screening (`compliance.mjs`), dApp policy and dry runs (`dapps.mjs`), one-time signing tickets (HMAC), gasless relay and treasury (`chain.mjs`), eBanking portal, KYC console, mock SMS/e-mail outbox | Clients, passkey public keys, wallet links, recoveries, encrypted backup of Part A, activity (`bank-server/data/`) |
| **Share vault** | `share-vault/` (Node.js, Express, DKLs23 for Node), port 4100 | **Mock** of Swissquote's key-share server: a **separate process with its own storage** | MPC party 1: key generation, co-signing, key refresh. Signs only with a valid single-use ticket for that exact hash; enforces the recovery time-lock and freezes; audit log | Part B, encrypted Part C, used tickets (`share-vault/data/vault.json`) |
| **Notary escrow** | Written by the vault (`share-vault/data/notary-escrow.json`) | **Mock** of an independent notary | A copy of Part B and the encrypted Part C, released only if Swissquote ceases operating | Copies |
| **Emergency tool** | `tools/emergency-recover.mjs` | **Real** | Signs with any two parts without any Swissquote server and moves all ETH/USDC/EURC to a new address | — |
| **Ethereum Sepolia** | Public RPC nodes; bank RPC proxy as fallback; Blockscout for history | **Real** (testnet) | Settlement; Circle's USDC/EURC (EIP-3009); WETH and Uniswap Permit2 as approved dApps | — |

The client app never holds Part B. The vault never sees Part A or the card words.

## Who talks to whom

| From → To | What |
|---|---|
| App → Bank | Login, screening, payment preparation (the bank rebuilds the hash itself), passkey approval, tickets, dApp simulation, recovery, devices, relay |
| App ↔ Vault | MPC rounds (key generation, signing, refresh), each started with a ticket from the bank |
| Bank → Vault | Tickets travel through the app; the bank calls the vault directly only to read the public key and to freeze recoveries |
| Vault → Notary | Mirrors Part B and the encrypted Part C after each key generation or refresh |
| App → Ethereum | Signed transactions and reads (public nodes, bank proxy as fallback) |
| Bank → Ethereum | Gasless relay (`transferWithAuthorization`), top-ups, dApp dry runs, screening lookups |

## Flows

**Create.** Bank login (password + SMS) → reference photo → passkey registration (Face ID) with PRF → `POST /api/wallet/keygen-ticket` → `POST /v1/keygen/start` + rounds on `/v1/mpc/:sid` (the app runs party 0, the vault party 1; a third share is created for the card) → the app seals A under the passkey (or wallet password) and C under the new card's 24 words → the wallet signs a Travel Rule ownership message (EIP-191, MPC-signed) → `POST /api/wallet/link`: the bank checks the signature against the vault's public key and links the address to the client.

**Pay (ETH, USDC, EURC, dApp call).** Trust Wallet Core builds the transaction and its hash → `POST /api/tx/prepare`: the bank rebuilds the hash from the fields, screens the real recipient (inside a token transfer: the recipient, not the token contract), for dApps runs the policy and a dry run, and returns a passkey challenge bound to that exact payment → Face ID (+ SMS code from CHF 1,000; CHF 20 on the testnet) → `POST /api/tx/approve` returns a ticket (2 minutes, single use, this hash only) → MPC signing with the vault → Trust Wallet Core compiles the signature → broadcast.

**Gasless USDC/EURC.** As above, but the signed object is an EIP-3009 `TransferWithAuthorization` (EIP-712, random nonce, valid 10 minutes). After co-signing, `POST /api/relay` lets Swissquote's treasury submit exactly that authorization and pay the gas: 10 per client per day, simulated first, only if approved.

**Add a device.** The device with the wallet encrypts A with a fresh key; the ciphertext goes to the bank, the key only into the QR link's `#fragment`. The new device logs in, registers its own passkey, decrypts A and seals it under its own passkey.

**Recover.** Login → selfie → KYC operator compares with the onboarding photo → time-lock (production 72 h, demo 15–90 s) with alerts to all devices, e-mail and eBanking, cancellable by the client → `recover-ticket` → the client's remaining part (synced passkey or backup file for A, card for C) and the vault run a key refresh: three new parts, same public key and address, new card. The old passkeys are revoked.

**Swissquote gone.** The notary releases its copy of B; `npm run recover-offline -- --client … --card … --to 0x…` (or `--backup`) signs with any two parts and sweeps all funds.

## Building blocks

| Need | Library (no homemade cryptography) |
|---|---|
| Threshold ECDSA (2-of-3, key refresh) | `@silencelaboratories/dkls-wasm-ll-web` / `-node` (DKLs23) |
| Transactions, hashes, ABI and EIP-712 encoding, addresses (ETH, BTC) | `@trustwallet/wallet-core` |
| Passkeys | WebAuthn in the browser, `@simplewebauthn/server` on the bank |
| Encryption of the parts | WebCrypto: AES-256-GCM, HKDF-SHA256, PBKDF2-SHA256 |
| Bank-side verification, relay, dry runs | `ethers` v6 |
