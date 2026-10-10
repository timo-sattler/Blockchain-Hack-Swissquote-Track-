# Custody model

> No crypto background? Read [`handbook.md`](handbook.md) first: it explains every term used here.

## Decision

**2-of-3 threshold signatures (MPC).** One private key is created directly as three *shares*, held by three parties. Any two shares can produce a signature together. The full key never exists anywhere, not even for a moment, not even during creation or recovery.

| Share | Held by | Stored where (prototype) | Stored where (production) | Unlocked by |
|---|---|---|---|---|
| **A** | Client's phone | Browser storage of the Swissquote app (`localStorage`, key `sq-mpc:wallet`) | Platform keychain, or encrypted with a key derived from the passkey (WebAuthn PRF) | Device unlock; the passkey gates every use with Swissquote |
| **B** | Swissquote share service | Its own process and folder (`services/data/share-service/wallets/*.json`) | HSM / secure enclave, dual control | Only used after a valid passkey login from the client |
| **C** | Client's recovery kit | A file the client downloads: Share C encrypted with a client-chosen password (PBKDF2-SHA256, 310 000 iterations, AES-256-GCM) | Same; stored in the client's cloud drive or on a USB stick | The kit password, which Swissquote never sees |

What signs what:

| Situation | Shares used | Swissquote involved? |
|---|---|---|
| Everyday payment | A + B | Yes: it verifies the passkey, decodes the transaction, screens it, then co-signs |
| Swissquote refuses or is offline | A + C | **No.** Phone and kit sign together on the device |
| Phone lost (recovery) | C + B rebuild a new A | Yes: identity check, waiting period, owner can cancel |

One pitch line: *Swissquote is a co-signer and recovery partner, never the owner of the key.*

## Why MPC (and not the alternatives)

We built and tested two models during the hackathon and chose MPC for the demo.

| Option | Verdict | Reason |
|---|---|---|
| Custodial account (Swissquote holds the key) | Rejected | Not self-custody; one insider or breach can drain funds; full custody regime |
| Seed phrase | Rejected | The most common cause of lost funds; a thief with the phrase looks exactly like the owner |
| Shamir / SLIP-39 split backup | Rejected | The full key is reassembled on one device during recovery: one compromised device at that moment loses everything |
| Smart account (ERC-4337) + passkey + guardian recovery | **Built and tested, not chosen** (see below) | Recovery rules enforced on-chain, friends can be guardians, gasless with a paymaster. But **EVM only**: no native Bitcoin |
| **2-of-3 MPC** | **Chosen** | One key for **Bitcoin and every EVM chain**; no seed phrase; Swissquote can screen payments before co-signing; the client can always sign without Swissquote (A + C) |

### The alternative we built: on-chain recovery for smart accounts

Branch `grace/recovery-multicoin` (not merged) contains a working smart-account version: a `RecoveryModule` contract where 2-of-N guardians (recovery kit, Swissquote, trusted friends) can replace a lost passkey after a time-lock that the owner can cancel.

- Deployed and source-verified on Base Sepolia: [`0x1F039424e76238D89FC2EC7A1061F19AABf89d98`](https://sepolia.basescan.org/address/0x1F039424e76238D89FC2EC7A1061F19AABf89d98)
- 12 Foundry tests on a fork of the real Coinbase Smart Wallet factory; a live end-to-end run with every step gas-sponsored: [setup](https://sepolia.basescan.org/tx/0x3ac07f83625957977c21fead23316f104760fce542838984ca9a703f2386480c), [collusion vetoed by the owner](https://sepolia.basescan.org/tx/0x0708326d0081de41cdb5bb21d5c139848329bf87a4dbb308de0935336dc5bc89), [recovery finished](https://sepolia.basescan.org/tx/0x7c60cdd0fe6f3a9394b200e4a37de07b8d1d436c22fc08027b170b08693515a3)

We kept MPC because Swissquote clients hold Bitcoin, and a smart account cannot hold native BTC. The smart-account recovery remains the better design for EVM-only assets and is our roadmap for on-chain, auditable recovery rules (see "Roadmap").

## Parameters

| Parameter | Demo | Production |
|---|---:|---:|
| Signing threshold | 2 of 3 | 2 of 3 |
| Recovery waiting period (owner can cancel) | 30 s (`RECOVERY_DELAY_SEC`) | 48 h |
| Extra confirmation above | 1 000 USDC | Set with compliance |
| Passkey login validity for co-signing | 5 min (server); fresh verification for every new transfer; token bound to one transaction or Bitcoin PSBT | Same or shorter |
| Device-pairing window after passkey login | 5 min | 5 min |
| Kit password minimum | 8 characters | Stronger policy + strength meter |

## Can Swissquote move client funds?

**Alone: no.** Swissquote holds one share; a signature needs two. It cannot sign a payment, and it cannot recover the wallet to a phone it controls, because rebuilding Share A needs the client's kit (C).

**With someone else:** only with the client's kit (Share C). Paths to Share C: the kit file **and** its password, or **two of the client's three trusted people** combining their pieces **and** the kit password (the pieces only give back the password-locked kit). The password is the client's secret in both paths, so the multi-party theft paths are Swissquote colluding with someone who has both the kit and its password, or with two friends who also crack the password. The escrow agent holds a copy of the **same** Share B, so Swissquote + escrow still hold only one share between them; the agent only acts when Swissquote is gone and deletes its copy afterwards.

**What Swissquote can do:** refuse to co-sign (the client then signs with phone + kit), screen and block payments it co-signs (sanctions list, high-value confirmation), and refuse or delay recovery.

## The three questions from the brief

| Question | Answer |
|---|---|
| **Who could steal funds?** | Someone with two shares. Realistic paths: (1) the phone's share A **plus** the kit file **plus** its password; (2) Share B (Swissquote breach or insider) **plus** the kit and its password. A stolen phone alone, a stolen kit alone or Swissquote alone cannot sign. In the prototype, Share A sits unencrypted in browser storage; production encrypts it with the passkey, so a stolen phone would also need the owner's biometrics |
| **Who could lock the client out?** | Swissquote can refuse to co-sign, but the client keeps full access with phone + kit. If the phone is lost, recovery normally needs Swissquote; if Swissquote has **disappeared**, the independent escrow agent steps in. A Swissquote that is still operating but **refuses** a legitimate recovery would block it (contractual obligation in the terms). Phone **and** kit lost: the kit is rebuilt from 2 of 3 friend pieces, if the client created them |
| **Could Swissquote, alone or with a partner, move the funds?** | Alone: no (1 of 3 shares). With a partner: no partner holds a share. Only with a stolen kit **and** its password |

## If Swissquote disappears

- The wallet is an ordinary Bitcoin address and an ordinary EVM address. Funds are on public blockchains, not on Swissquote's balance sheet.
- The client signs with **phone + kit** (A + C) in the app, entirely on the device, without any Swissquote server. The app offers this automatically when Swissquote does not answer.
- **Phone lost too:** the independent escrow agent (mock notary, separate process) holds a copy of Share B. After Swissquote has been unreachable long enough and the client passes the agent's identity check, kit + escrow issue a new phone share; the agent then deletes its copy. Built and tested.
- What stops working: co-signing with screening, gasless USDC, the welcome bonus.

## Wallet creation and link to the client's identity

1. The client is in the Swissquote app (logged in, KYC done; mocked in the prototype) and opens the Crypto tab.
2. The app registers a **passkey** with the share service (Face ID / fingerprint, user verification required, discoverable credential).
3. Phone (party A, also running party C locally) and share service (party B) run **distributed key generation** (DKLs23, Silence Laboratories). Result: three shares and one public key. The Bitcoin (SegWit, `tb1…`) and EVM (`0x…`) addresses are derived from that public key.
4. Share C is encrypted with the client's password and downloaded as the recovery kit (about 250 KB). It is never stored on the phone: the app only remembers *when* the kit was saved.
5. Swissquote stores the wallet record (wallet ID, name, public key, addresses, passkey public key, Share B). Because Swissquote **co-generated** the key inside the client's session and holds one of its shares, it knows the addresses belong to that client without any extra proof. Production stores the client ID in the same record. See [`legal-compliance.md`](legal-compliance.md).

## Authentication: small vs. high-value payments

- **Every** co-signed payment requires a passkey login (Face ID / fingerprint) that Swissquote verifies server-side.
- Swissquote **decodes the transaction itself** (EVM transaction or Bitcoin PSBT), computes the hash it signs, and checks recipients against the sanctions list (mock). The phone compares Swissquote's hash with its own and aborts if they differ, so neither side can trick the other into signing something else.
- **Above 1 000 USDC**, Swissquote answers `428` and the app asks for an explicit extra confirmation before co-signing again. Production: a fresh Face ID plus, for new recipients, a cooling-off period or call-back.

## Known gaps (honest list)

| Gap | Impact | Mitigation (planned) |
|---|---|---|
| Share A unencrypted in browser storage | A stolen, unlocked device exposes Share A | Encrypt with a passkey-derived key (WebAuthn PRF) or the OS keychain |
| ~~Phone **and** kit lost~~ | **Solved:** the password-locked kit split among 3 trusted people (Shamir, any 2 give it back, the client's password opens it); a lost or stolen kit can be **replaced** by phone + Swissquote, which makes the old kit worthless | Only covers clients who created the pieces and remember the kit password |
| ~~Phone lost and Swissquote gone~~ | **Solved:** independent escrow agent stands in for Swissquote once (mock) | Production: notary contract, HSM, liquidation trigger |
| ~~No gasless transfers~~ | **Solved for USDC:** EIP-3009 authorizations relayed by Swissquote, which pays the fee; daily quota per wallet | ETH and BTC sends still pay their own fee |
| Old phone share + **old** kit still form a valid pair after a recovery | A thief with both could still sign offline | App tells the client to delete the old kit; optional "sweep" to a fresh key after a theft |
| Recovery rules enforced by Swissquote's server | Not publicly auditable | On-chain recovery registry (Roadmap) |
| Screening is enforced by the app, not by cryptography | The Swissquote app screens every payment, also phone + kit while Swissquote is offline (last copy of the list on the device). Someone who extracts their own shares and writes their own software can pay anyone, as with any self-custody wallet | Design choice, see below |
| Silence Laboratories library under a non-commercial licence | Production needs a commercial licence | Licence or switch to another audited DKLs implementation |

### Design choice: screening enforced by the app, or by the cryptography

| | Built: the USB kit is a **different** share | Alternative: the USB holds an **identical copy** of the device share |
|---|---|---|
| Who can sign | Device + Swissquote (normal), device + USB (Swissquote down) | Only device or USB **+ Swissquote** |
| Screening | Every payment in the app; a client with their own software could skip it | Enforced: nothing can be signed without Swissquote |
| Swissquote disappears | Device + USB keep working at once | Client is stuck until the escrow agent steps in (it holds a copy of Swissquote's share) |
| Who could lock the client out | Nobody | Swissquote, while it operates |
| Device **and** USB lost | Swissquote + kit pieces from friends | Funds lost, unless friends hold a backup of the device share |
| Travel Rule | Client can pay without Swissquote: argument that Swissquote is not the sender | Swissquote takes part in every payment: likely the sending institution, with originator data for every transfer |

We chose the left column for the prototype (stronger self-custody, no lock-out). The right column is a valid product choice for a bank that wants screening guaranteed; it needs a 2-of-2 key between client and Swissquote plus the escrow copy, and is on the roadmap.

## Roadmap

1. ~~Social backup~~, ~~gasless USDC~~, ~~escrow of Share B~~, ~~on-chain backup between friends~~ ([`onchain-backup.md`](onchain-backup.md)): built (see Known gaps).
2. **On-chain recovery registry:** recovery requests, approvals by trusted friends, the waiting period and the owner's veto recorded on-chain; Swissquote's share service only joins a recovery the contract approved. Based on the `RecoveryModule` we already deployed.
3. **Share A encrypted with the passkey** (WebAuthn PRF) so a stolen, unlocked phone cannot read its share.
