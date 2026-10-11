# Swissquote Crypto Wallet: DoraHacks submission

**Track:** Swissquote, *Build the Swissquote Wallet*
**Repository:** https://github.com/timo-sattler/Blockchain-Hack-Swissquote-Track-
**Demo video:** _add link_
**Run it:** [`GUIDE.md`](GUIDE.md) (one command, about 5 minutes)

## One line

A self-custody wallet a Swissquote client unlocks with Face ID: the key is split into three parts and never exists in one place, Swissquote screens and co-signs every payment and pays the fee for stablecoins, but it can never move the money on its own, and a lost phone is never a lost fortune.

## The problem

Swissquote clients who want their own keys withdraw to an external wallet and leave: 24 seed words they will lose, no protection against scams, ETH needed to move USDC, and a manual Travel Rule check for every withdrawal. An estimated 2.8–3.8M BTC are lost for good.

## What we built

| | |
|---|---|
| **Custody model** | 2-of-3 MPC key (DKLs23 threshold ECDSA). Part A on the client's devices (Face ID), Part B in Swissquote's share vault (copy with an independent notary), Part C locked by a paper Recovery Card. Any two sign; Swissquote alone, or with the notary, can't. [`docs/custody-model.md`](docs/custody-model.md) |
| **Wallet creation** | Swissquote login (password + SMS), reference photo, Face ID. The phone and the vault generate the key together; the wallet proves its ownership to Swissquote automatically (Travel Rule). |
| **Authentication** | A passkey signature over the exact payment for every transaction; above CHF 1,000 (CHF 20 on the testnet) also an SMS code; wallet-password fallback on devices without passkey encryption. |
| **Signing** | Trust Wallet Core builds every transaction; the bank rebuilds and screens it; the vault co-signs only that hash with a single-use ticket; the transaction is sent to Ethereum Sepolia. |
| **Recovery** | Synced passkey, backup file or paper card + selfie check + 72-hour time-lock the client can block → all three parts renewed, same address. An attacker with the stolen phone and e-mail is refused (demo included). If Swissquote is gone: notary + open-source emergency tool. |
| **Business case** | Recovery subscription (CHF 4.90 / month or CHF 99 per recovery), assets kept in the Swissquote ecosystem, no manual ownership checks, no custody burden. [`docs/business-case.md`](docs/business-case.md) |
| **Legal** | Not custody (Swissquote can only block, never move, and the client can always sign alone); automatic Travel Rule ownership proof. [`docs/legal-compliance.md`](docs/legal-compliance.md) |

## Bonus topics

- **Gasless transactions:** USDC and EURC via EIP-3009 `transferWithAuthorization`, MPC-signed by the client and relayed by Swissquote's treasury, which pays the gas. Abuse prevention: 10 per client per day, screening first, only the exact Face-ID-approved authorization, simulated before submission, short validity and one-time nonce.
- **Compliant dApp interaction:** an **Apps** screen (wrap ETH into WETH). Approved dApps only, requests decoded, a dry run on Sepolia, effects in plain language before signing, token approvals only to approved dApps and never unlimited, sanctions screening; scam requests are refused before anything is signed.

## Architecture

![Architecture](docs/img/architecture.png)

Real: MPC (Silence Laboratories DKLs23), Trust Wallet Core, passkeys (WebAuthn PRF), Ethereum Sepolia, gasless relay, screening and dApp logic. Mocked, as separate processes with their own storage: Swissquote's bank backend (login, SMS, KYC console) and the share vault; the notary escrow is a file. [`docs/architecture.md`](docs/architecture.md)

## Tech stack

React + TypeScript + Vite (installable iPhone web app in Swissquote's dark style) · `@trustwallet/wallet-core` · `@silencelaboratories/dkls-wasm-ll-web` / `-node` · WebAuthn + `@simplewebauthn/server` · WebCrypto (AES-256-GCM, HKDF, PBKDF2) · Node.js + Express · ethers v6 · Circle USDC/EURC, WETH, Uniswap Permit2 on Sepolia · Playwright and `node:test` for end-to-end tests.

## Proof it works

`npm test`: 15 end-to-end API tests (key creation, co-signing, screening, SMS for high values, gasless, dApp policy, devices, recovery attacks, paper-card recovery, emergency tool). `npm run test:browser`: two full browser runs with a virtual Face ID (create → sign → add device → lose → recover).

## AI tools

See [`pitch/ai-tools.md`](pitch/ai-tools.md).

## Team

_Vincent, Maxi, Grace, Jeroen, Timo_
