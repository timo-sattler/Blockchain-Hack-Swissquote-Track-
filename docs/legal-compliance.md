# Legal & compliance (Switzerland)

> Engineering reasoning to prepare a conversation with counsel, **not legal advice**. Based on the legal primer in [`challenge-brief.md`](challenge-brief.md). Plain-language background: [`handbook.md`](handbook.md).

## 1. Custody or software?

The brief's test: *custody depends on who can move the funds.* If Swissquote can move a client's crypto on its own, it is custody, with a bank's capital, segregation and insurance duties.

**Our position: the wallet is self-custody with a mandatory co-signer, not custody.**

| Fact about the design | Why it matters |
|---|---|
| The key exists only as two parts; **both** are needed to sign | Nobody with one part can move funds |
| Swissquote holds **one** part (B) | It cannot sign a payment alone (tested, and demonstrated on its own database) |
| The client's part (A) is created on the client's device and never sent to Swissquote; copies to the client's other devices travel encrypted with a key Swissquote never sees | Swissquote cannot obtain part A |
| The escrow agent holds a **copy of B**, not a third part | Swissquote + agent together still cannot sign: no "Swissquote + partner" path, so the primer's grey zone does not arise |
| Funds sit at the client's own addresses on public blockchains | They never appear on Swissquote's balance sheet; a Swissquote insolvency does not touch them |

**What Swissquote can do:** refuse to co-sign (sanctioned or scam recipients, limits, an unrecognised device), and stop paying fees. All of these can only **stop** a payment, never **make** one. Because Swissquote takes part in every payment, it is a gatekeeper while it operates. We argue that the power to block is not a power of disposal, but this is the main point to confirm with counsel. The six-month grace period with the escrow agent guarantees that the client regains sole control if Swissquote stops operating.

## 2. Travel Rule and verified ownership

FINMA applies the Travel Rule strictly (FINMA Guidance 02/2019). A Swiss bank may only send crypto to, or receive it from, an external wallet after verifying that its own client controls it. Today that is a manual step (signed messages, test transfers, screenshots).

**Ownership by construction.** The wallet is created inside the client's authenticated Swissquote session; Swissquote's share service takes part in creating the key and keeps one part. The wallet record links the client, the public key and the derived addresses from the first second. Transfers between the client's Swissquote account and this wallet are transfers between two places the same verified client controls: no manual ownership check needed.

**Payments to third parties.** Swissquote co-signs and screens every payment from the wallet, so we treat Swissquote as the **sending institution**: it screens every recipient (implemented), and for transfers to another regulated provider it would attach originator and beneficiary data through a Travel Rule messaging protocol (production). For payments to third parties' unhosted wallets, the bank applies its risk-based controls (screening, limits). Counsel should confirm the exact duties for this case.

| Prototype | Production |
|---|---|
| Wallet record: wallet ID, name, public key, addresses, passkeys of the client's devices | Plus the Swissquote client ID, written by core banking at creation |
| Client login and KYC mocked | Swissquote e-banking login and existing KYC |
| Recipient screening against a mock list | Chain-analytics provider (e.g. Chainalysis, Elliptic) |
| No Travel Rule messaging | Travel Rule protocol for transfers to regulated providers |

## 3. AML, sanctions and transaction policy

Implemented as real code in the share service (`services/share-service.mjs`), with mocked data sources:

| Control | Implementation | Production data source |
|---|---|---|
| Swissquote reads what it signs | Decodes the EVM transaction, the EIP-3009 authorization or the Bitcoin PSBT itself and signs its **own** hash (the app checks the hashes match) | Same |
| Screening | Every recipient is checked before anything is signed; a match is refused (`403`) with the reason and logged | Chain-analytics provider |
| High-value payments | Above 1,000 USDC / EURC the service answers `428` and the client confirms explicitly with a fresh Face ID | Thresholds set by compliance |
| Allowed assets and networks | Base Sepolia (USDC, EURC, ETH) and Bitcoin testnet4 only; contract calls other than plain token transfers are refused | Allow-list maintained by compliance |
| Devices | Only registered devices' passkeys are accepted; removed devices are refused | Same, plus device attestation |

## 4. Insolvency and the grace period

If Swissquote stops operating, the wallet is paused. After six months the independent escrow agent (in production a regulated notary bound by contract, holding the copy of B in an HSM) hands its copy to the client's device, which then signs alone. Six months match an orderly wind-down, during which an administrator could also hand the service to a successor. The client's assets are never part of the bankruptcy estate, but they are not accessible during the grace period: the terms of use must say so clearly, and counsel should assess whether a shorter period is required.

## 5. Data protection (revFADP)

Swissquote stores only what it needs: wallet ID, client name/ID, public key and addresses, the passkeys' public keys and device names, part B, sponsoring counters and an event log. It never receives the passkeys' private keys or the client's part (copies to other devices pass through Swissquote encrypted with a key it never sees). Blockchain addresses linked to a client are personal data and are handled like account numbers.

## 6. Other points for counsel

- **Licence of the MPC library:** Silence Laboratories' Silent Shard (DKLs23) is used under a non-commercial licence; a launch needs a commercial licence.
- **Terms of use:** losing every device that holds the client's part means losing the funds; Swissquote cannot reverse transactions; the wallet pauses during the grace period.
- **Escrow contract:** the agent's duties, the trigger for release (insolvency, confirmed by the administrator), and deletion of its copy afterwards.

## Real vs. mocked

| Part | Prototype | Production |
|---|---|---|
| Client login and KYC | Mocked | Swissquote e-banking + KYC |
| Ownership by construction (key co-generation) | **Real** | Same, plus client ID in the record |
| Screening | Real policy, mock list | Chain-analytics provider |
| High-value confirmation | **Real** (`428` + fresh Face ID) | Plus cooling-off for new recipients |
| Escrow agent and grace period | Mock process, 30-second grace period | Notary contract, HSM, six months |
