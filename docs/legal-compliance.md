# Legal & compliance (Switzerland)

> Engineering reasoning to prepare a conversation with counsel, **not legal advice**. Based on the legal primer in [`challenge-brief.md`](challenge-brief.md).

## 1. Custody or software?

The primer's test: *custody depends on who can move the funds.*

**Our position: self-custody software with a co-signing service, not custody.**

| Fact about the design | Why it matters |
|---|---|
| The key is a 2-of-3 MPC key; any **two** parts sign | One part alone moves nothing |
| Swissquote holds **one** part (B) | It can't sign alone (tested: one part, or the same part twice, can't sign) |
| A is created on the client's device and only leaves it encrypted under the client's passkey or password; copies to other devices travel with a key Swissquote never sees | Swissquote can't obtain A |
| C is encrypted under the client's paper card; Swissquote stores only the ciphertext | Swissquote can't obtain C |
| The client alone can sign with A + C | Swissquote is not needed to move the funds, so it does not control them |
| Funds sit at the client's own address on a public blockchain | Never on Swissquote's balance sheet; not part of an insolvency estate |

**Swissquote + a partner (the grey zone).** The notary holds a **copy of B**, not a third part. Swissquote and the notary together still hold one part, so there is no "Swissquote + partner" path to the funds. The recovery process can't be turned into one either: it always needs a part from the client (passkey, backup file or card), a selfie check and a time-lock the client can cancel.

**What Swissquote can do:** refuse to co-sign (sanctioned or scam recipients, unknown dApps, limits, an unrecognised device), stop sponsoring fees, and run the recovery checks. All of these can only **stop** a payment, never **make** one, and the client can still sign with A + C. We argue that a power to block, which the client can always route around, is not a power of disposal. This is the main point to confirm with counsel.

## 2. Travel Rule and verified ownership

Under FINMA's rules (Guidance 02/2019), a Swiss bank may send crypto to, or receive it from, an external wallet only after verifying that its client controls it. Today that is a manual step (signed messages, micro-transfers, screenshots).

**Ownership proof, automatic.** The wallet is created inside the client's authenticated Swissquote session, and Swissquote's vault takes part in key generation. Right after creation, the wallet MPC-signs an ownership message (EIP-191, with client ID, address, chain and a nonce); the bank verifies the signature against the public key its own vault holds and stores the proof with the client record (`travelRule.status: verified-self-hosted`). Every later deposit to or withdrawal from the client's Swissquote account is between two places the same verified client controls: no manual check.

**Paying a third party from the wallet.** The client signs with their own key; Swissquote co-signs but never holds or transfers the client's assets. We therefore treat Swissquote **not** as the sending institution for these payments (the app says so on the review screen). Swissquote still screens every recipient and applies limits, voluntarily and as risk management. Two cases the app distinguishes:

| Recipient | What the app says |
|---|---|
| Another Swissquote Wallet | Both owners are verified Swissquote clients; no external message needed |
| The client's own Swissquote account | Deposit from a wallet already proven to be the client's |
| An external self-hosted wallet | Self-custody payment; Swissquote is not the sending institution; screened |
| A known exchange or service (production) | The receiving institution runs its own Travel Rule checks; Swissquote could attach data via a Travel Rule network (e.g. TRP, Notabene) if counsel requires it |

## 3. AML, sanctions and transaction policy

Real code, mocked data sources:

| Control | Implementation | Production data |
|---|---|---|
| Swissquote reads what it signs | The bank rebuilds every hash from the transaction fields, decodes token transfers and dApp calls, and the vault signs only that hash; the app aborts if the bank's hash differs from its own | Same |
| Screening | Every recipient (also inside token transfers) and every dApp contract and token spender, before anything is signed (`compliance.mjs`) | Chainalysis / Elliptic / TRM |
| High-value payments | From CHF 1,000 (CHF 20 on the testnet): Face ID **and** an SMS code bound to that payment | Thresholds set by compliance |
| Daily limit | CHF 5,000 per client per day | Risk-based |
| dApps | Approved list only; known functions only; dry run on the network; plain-language effects; token approvals only to approved dApps and never unlimited (`dapps.mjs`) | Reviewed list maintained by compliance |
| Gasless | 10 sponsored transfers per client per day, exact authorization only | Pricing tiers |
| Devices | Only the client's registered passkeys; removed devices are refused | Plus device attestation |

## 4. Recovery and insolvency

- **Recovery** is an identity process Swissquote already masters (KYC), plus a time-lock with alerts. It never gives Swissquote a second part.
- **Insolvency or permanent shutdown:** the client keeps full access with A + C at any time. In addition, the independent notary (in production: a contract with a Swiss notary, the copy in an HSM) releases its copy of B on a confirmed cessation, so a client who lost the card can still recover with A + B. The open-source tool does it without any Swissquote server.

## 5. Data protection (revFADP)

Swissquote stores: client data it already has, the wallet address and public key, passkey public keys and device names, Part B, ciphertexts it can't open (A backup, C), recoveries with selfies, and an activity log. Addresses linked to a client are personal data and are handled like account numbers. Selfies are kept only for the recovery and its audit.

## 6. Points for counsel

- Confirm that a blocking-only co-signer the client can bypass is not custody.
- Confirm Swissquote is not the sending institution for client-signed payments to third parties.
- MPC library licence: Silence Laboratories' DKLs23 is used under its non-commercial licence; a launch needs a commercial licence.
- Terms of use: losing every device **and** the card **and** the backup means losing the funds; transactions can't be reversed; what Swissquote screens and what it doesn't when the client signs alone.
- Notary contract: trigger for release, HSM custody of the copy, deletion afterwards.

## Real vs. mocked

| Part | Prototype | Production |
|---|---|---|
| Client login, SMS, KYC | Mocked (codes shown on screen, operator console) | Swissquote e-banking and KYC |
| Ownership proof | **Real** (MPC-signed, verified against the vault's key) | Same, stored in core banking |
| Screening | Real policy, mock list | Chain-analytics provider |
| dApp policy and dry run | **Real**, small approved list | List maintained by compliance |
| Notary | File written by the vault | Contract with a notary, HSM |
