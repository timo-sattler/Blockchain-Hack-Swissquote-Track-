# Custody model: one key, two parts

> Who holds which part, what each party can and cannot do, and how we prove it. Plain-language version: [`handbook.md`](handbook.md).

## The decision

| Part | Who holds it | Unlocked by |
|---|---|---|
| **A: the client's part** | The client's laptop, with **identical copies** on their other devices (phone, second laptop) | Each device's own passkey (Face ID / Touch ID / fingerprint) |
| **B: Swissquote's part** | Swissquote's share service (separate process, own storage) | Swissquote's policy: passkey login, screening, limits |
| *Copy of B* | Independent escrow agent (a notary in production; a mock process here) | Released only after the grace period |

The key is created with **two-party threshold ECDSA** (Silence Labs Silent Shard, DKLs23, 2-of-2). Every signature is computed jointly from both parts; the full private key is never assembled, not even for a moment. One public key gives a Bitcoin address and an EVM address.

**Why two parts.** Every payment then needs Swissquote's part, so Swissquote's screening and its fee sponsoring apply to every payment and cannot be skipped by the client's own devices. The client's devices hold identical copies of one part, so adding a phone never creates a second signing path without Swissquote.

## Alternatives we considered

| Design | Why not |
|---|---|
| **2-of-3** (device, Swissquote, a recovery kit the client keeps) | Device + kit can sign without Swissquote, so screening and sponsoring become optional. Built and tested on branch `grace/mpc-docs` |
| **Smart-contract account** (ERC-4337, passkey + guardians) | Recovery rules on-chain, but EVM only (no Bitcoin) and a contract per network. Built and tested on branch `grace/recovery-multicoin` |
| **Swissquote holds the key** | Custody, with a bank's capital and segregation duties, and the client's control gone |

## What happens in each situation

| Situation | What happens |
|---|---|
| **Create** | Face ID passkey with Swissquote → two-party key generation → part A stays on this device, part B at Swissquote. Swissquote deposits a copy of B with the escrow agent |
| **Pay** | Face ID → Swissquote checks the recipient against its list of malicious addresses and decodes the transaction → both parts sign (MPC) → broadcast. USDC and EURC are free: the client signs an EIP-3009 authorization and Swissquote's treasury submits it |
| **Malicious recipient** | Refused before anything is signed. The app shows *Blocked by Swissquote*; the live presentation shows *Payment blocked* |
| **Add a device** | Face ID on a device that has part A → one-time link / QR code (10 minutes, single use). The new device creates its own passkey and receives an identical copy of A, encrypted with a key that exists only inside the link (URL fragment, never sent to a server). Swissquote relays a copy it cannot read |
| **Lose a device** | On another device: *Remove*. Swissquote stops accepting the lost device's passkey, so its copy of A is useless. To use a new device: *Add a device* again |
| **Swissquote unreachable** | The wallet is **paused**: nothing can be signed without part B |
| **Grace period over** | Swissquote unreachable for six months (demo: 30 s): a device proves it holds A by co-signing a one-time challenge with the escrow agent, which then hands over its copy of B and deletes it. The device now holds both parts and signs alone (no screening, no sponsoring) |
| **Every device lost** | The wallet is lost. The app recommends a second device right after creation |

## Coins

| In the app today | Network | Free through Swissquote |
|---|---|---|
| USDC | Base Sepolia | Yes |
| EURC (euro stablecoin) | Base Sepolia | Yes |
| ETH | Base Sepolia | No (pays its own fee) |
| BTC | Bitcoin testnet4 | No |

The same public key also gives addresses on Ethereum, Arbitrum, Optimism, Polygon, BNB Chain and Avalanche (the same `0x` address), Litecoin, Dogecoin and Tron; the app lists them under *Receive*. No contract has to be deployed anywhere: enabling another network only needs Swissquote's signing policy to allow it. Ed25519 networks (Solana, Cardano, Sui, Aptos) need a second MPC library (roadmap).

## The three questions from the brief

| Question | Answer |
|---|---|
| **Who could steal funds?** | Nobody with one part. A thief needs one of the client's devices *and* its Face ID, and still passes Swissquote's screening. A lost device is removed in one tap |
| **Who could lock the client out?** | Swissquote could refuse to co-sign while it operates: that is how it blocks malicious payments. If it fails or disappears, the grace period ends the pause |
| **Could Swissquote move client funds?** | No. It holds one of two parts. The escrow agent holds a copy of the **same** part B, so Swissquote and the agent together still cannot sign without the client |

## Proof that Swissquote cannot act alone

1. **The math.** Two-party threshold ECDSA: a signature needs both parts, in four message rounds. The private key is never reconstructed.
2. **Tests anyone can rerun** (`cd services && npm test`): client part + Swissquote's part sign; Swissquote + the escrow copy cannot (the same part twice); Swissquote + a forged client part cannot; an identical copy on another device signs like the original. See [`threat-model.md`](threat-model.md) for the full security suite.
3. **A live insider attack on the real database** (`cd services && npm run insider`, optionally `-- <name> --scan`): Swissquote's stored part and the escrow copy try to sign "send everything to the insider". Every attempt fails; with `--scan` it also checks every 32-byte value in Swissquote's part and confirms none is the private key. It prints no secrets.
4. **In the app:** *How my key works* shows fingerprints (SHA-256) of the parts, never the parts: the client's devices show the **same** fingerprint, Swissquote's is **different**, the escrow agent's is **identical to Swissquote's**. It also lists every protocol message of the last signature: a few kilobytes each way, while the 121 KB part stays on the device.

## Parameters

| Parameter | Prototype | Production |
|---|---|---|
| Grace period before the escrow agent releases its copy | 30 s (`ESCROW_OUTAGE_SEC`) | Six months, triggered by Swissquote's insolvency administrator |
| Add-a-device link | 10 minutes, single use | Same |
| Login token | 5 minutes, bound to one transfer | Same |
| Extra confirmation | Above 1,000 USDC / EURC | Thresholds set by compliance |
| Sponsored transfers | 10 per wallet per day (`RELAYS_PER_DAY`) | Set by product |

## Honest limits

- Losing **every** device that holds part A means losing the wallet.
- During the grace period the wallet is paused.
- Part A sits in the browser's storage on each device. Production encrypts it with a key from the passkey (WebAuthn PRF) or keeps it in the platform keychain.
- Whoever opens an *Add a device* link within 10 minutes can add a device: show it only as a QR code or send it to yourself. Every added device appears in the device list and the live feed, and can be removed.
- The MPC library is licensed for non-commercial use; a launch needs a commercial licence.
