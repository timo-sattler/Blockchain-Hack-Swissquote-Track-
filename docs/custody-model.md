# Custody model: one key, three parts, any two sign

**Decision: a 2-of-3 MPC key (threshold ECDSA), with Swissquote as one of the three holders.** The client keeps two parts (one on their devices, one locked by a paper card they keep or give to someone they trust). Swissquote keeps the third, in a separate share vault, with a copy at an independent notary.

## Who holds what

| Part | Held by | Protected by | Used for |
|---|---|---|---|
| **A** | The client's devices (identical copies on phone and laptop) | AES-256-GCM, key derived from the device's passkey (Face ID, WebAuthn PRF), or from a wallet password (PBKDF2, 600,000 rounds) where the passkey can't | Every payment, together with B |
| **B** | Swissquote's share vault, a separate service with its own storage. A copy sits with an independent notary | Vault access control; production: an HSM or secure enclave | Co-signs only the exact transaction Swissquote approved |
| **C** | Encrypted under the client's **paper Recovery Card** (24 words). The ciphertext is stored by the vault, the notary, each device and the backup file | AES-256-GCM, key derived from the 24 words (HKDF-SHA256) | Recovery, and paying without Swissquote (A + C) |

The key is created with DKLs23 (Silence Laboratories): the client's device and the vault run a distributed key generation; the full private key never exists, not during creation, not when signing, not during recovery. Every signature is an ordinary ECDSA signature on secp256k1, so the same key works for Ethereum and every EVM chain **and for Bitcoin** (the app already derives the Bitcoin address; sending Bitcoin needs only Bitcoin transaction building, the MPC signing is the same).

## Why this model

| Considered | Verdict |
|---|---|
| **Custodial account** | Not a wallet: Swissquote moves the funds, with the full capital and segregation burden. Clients who want self-custody would still leave |
| **Seed phrase** | A typical Swissquote client will not keep 24 words safe for years; one photo of the words and the money is gone. No screening, no help after a loss |
| **ERC-4337 smart account** | Elegant on-chain rules, but EVM-only (no Bitcoin), a contract per client and per chain, and on-chain recovery logic that must be audited per chain |
| **Shamir / SLIP-39 split backup** | The seed is put back together on one device to sign, and Swissquote + the partner could restore it without the client |
| **2-of-2 MPC (client + Swissquote)** | Swissquote screens every payment, but if Swissquote disappears the client is stuck until an escrow releases B; losing every device means losing the funds |
| **2-of-3 MPC (chosen)** | The key is never whole; Swissquote co-signs everyday payments (screening, gasless), the client can always sign without Swissquote (A + C), and losing any one part is recoverable |

**Pros**
- No single place holds the key: not the phone, not Swissquote, not the paper card.
- Everyday payments go through Swissquote's screening and fee sponsoring, with Face ID only (no seed words).
- Any one part can be lost: a lost phone, a lost card, or Swissquote being gone, without losing the funds.
- One key for Bitcoin and every EVM chain; no smart contract to deploy per client.
- Ownership is known by construction (Travel Rule), because Swissquote takes part in key creation.

**Cons**
- The client can bypass Swissquote's screening by signing A + C. We accept this: it is the price of real self-custody, it needs the paper card, and Swissquote is not liable for payments it did not co-sign.
- The client must keep the Recovery Card; losing the card **and** every device at the same time means only Swissquote's part is left, which is not enough.
- MPC needs a commercial licence for the library and an HSM-grade vault in production.
- Signing needs an online round-trip to the vault for normal payments.

## The questions from the brief

**Who could steal funds?** Only someone with two parts: the client's device plus Face ID (A) together with Swissquote's approval (B) or the paper card (C). See the [threat model](threat-model.md).

**Who could lock the client out?** Nobody alone. If Swissquote refuses to co-sign, the client signs with A + C. If the phone is lost, recovery uses C (or the synced passkey, or the backup file) plus B. If Swissquote is gone for good, the notary's copy of B plus any client part works, with the open-source tool.

**Could Swissquote, alone or with a partner, move the funds without the client?** No.
- Swissquote alone has B only. The encrypted copy of A it keeps (for passkey recovery) opens only with the client's passkey; the encrypted C opens only with the client's card.
- Swissquote **plus the notary** still has B twice (the notary holds a copy of B, not a third part) and the same encrypted C. Two copies of one part are still one part.
- Swissquote can't use its recovery process against the client: a recovery needs one part from the client (passkey, backup file or card), a selfie check, and a time-lock during which the client is alerted and can block it.

The API test suite proves the signing side: one part, or the same part twice, can't sign (`tests/e2e-api.test.mjs`).

## Every situation

| Situation | What happens | Parts |
|---|---|---|
| **Create** | Bank login (password + SMS), reference photo, Face ID. Device and vault generate the key together; the device seals A, the card words seal C | A + B generated, C sealed |
| **Pay** | Swissquote screens the real recipient, the client approves with Face ID (+ SMS above CHF 1,000), the vault co-signs that exact hash | A + B |
| **Pay for free (USDC, EURC)** | Same, but the signed EIP-3009 authorization is submitted by Swissquote, which pays the fee | A + B |
| **Use a dApp** | Approved dApps only, explained after a dry run, no unlimited approvals | A + B |
| **New phone** | "Add a device": the old device encrypts A with a one-time key carried in the QR code; Swissquote relays a copy it can't read | A copied |
| **Lost phone, other device left** | Remove it on the other device; Swissquote refuses its passkey from then on | — |
| **Lost every device** | Login, selfie check (KYC), 72-hour time-lock with alerts, then the part the client still has (synced passkey for A, backup file for A, or card for C) + B refresh **all three parts**: same address, new card | A or C, + B |
| **Swissquote offline** | "Continue without Swissquote": A + C on the device, no screening | A + C |
| **Swissquote gone for good** | The notary releases its copy of B; `npm run recover-offline` moves everything with any two parts | any 2 |
