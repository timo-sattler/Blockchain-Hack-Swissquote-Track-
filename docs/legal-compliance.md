# Legal & compliance (Switzerland)

> Engineering reasoning to prepare a conversation with counsel, **not legal advice**. Based on the legal primer in [`challenge-brief.md`](challenge-brief.md). Plain-language background: [`handbook.md`](handbook.md).

## 1. Custody or software?

The brief's test: *custody depends on who can move the funds.* If Swissquote can move the client's crypto on its own, it is custody, with a bank's capital and segregation rules.

**Our position: this is self-custody software with a co-signing service, not custody.**

| Fact about the design | Why it matters |
|---|---|
| The key exists only as three shares; any **two** sign | Nobody with one share can move funds |
| Swissquote holds **one** share (B) | It cannot sign a payment alone |
| Rebuilding a lost phone share needs the client's kit (C) **and** its password | Swissquote cannot "recover" the wallet to a device it controls |
| The client can sign **without** Swissquote (phone A + kit C) | Swissquote is not a gatekeeper the client depends on to spend |
| No partner, guardian or second institution holds a share | There is no "Swissquote + partner" path, so the primer's grey zone does not arise |
| Funds sit at the client's own addresses on public blockchains | They never appear on Swissquote's balance sheet; a Swissquote insolvency does not touch them, and the client keeps spending with phone + kit |

What Swissquote **can** do (and why that does not amount to a power of disposal): refuse to co-sign, block payments to sanctioned addresses, require an extra confirmation for large amounts, refuse or delay recoveries. All of these can only **stop** a payment, never **make** one.

**Future features and their effect:**
- *Escrow of Share B with an independent agent* (built as a mock, for the "Swissquote is gone" case): the agent holds a copy of the **same** share, so Swissquote + agent still hold one share between them: still no power of disposal. It acts once, after Swissquote is gone, and deletes its copy.
- *Kit pieces with friends:* two of the client's friends can give back the client's **password-locked** kit; opening it still needs the kit password, which only the client knows. Friends therefore never hold a usable share, alone or together, and Swissquote + friends still hold only Share B. It is a backup the **client** sets up and controls (and can invalidate by replacing the kit), not a share Swissquote or a partner holds.
- *Gasless USDC:* Swissquote pays network fees for transfers it has screened and co-signed. Paying a fee does not give it any power over the funds.
- *A fourth share held by a partner* (considered, rejected): Swissquote + partner would hold two shares and could sign without the client. That is exactly the grey zone the primer warns about, which is why we did not build it.

## 2. Travel Rule and verified ownership of self-hosted wallets

Background: FINMA applies the Travel Rule strictly (FINMA Guidance 02/2019 on payments on the blockchain). A Swiss bank may only send crypto to, or receive it from, an external wallet after verifying that its own client owns it. Today that is a manual step for Swissquote and its clients (signed messages, test transfers, screenshots).

**How our wallet makes it automatic: ownership by construction.**

1. The wallet is created inside the client's authenticated Swissquote session (client logged in, KYC done; mocked in the prototype).
2. Swissquote's share service **takes part in creating the key** (distributed key generation) and keeps one share.
3. The wallet record therefore links the client, the public key and the derived addresses (Bitcoin `tb1…`, EVM `0x…`) from the very first second. No signed message, test transfer or screenshot is needed: Swissquote co-created the key and can co-sign with it at any time.
4. Transfers between the client's Swissquote account and this wallet are transfers between two places the **same verified client** controls.

| Prototype | Production |
|---|---|
| Wallet record stores wallet ID, name, public key, addresses, passkey public key | Same plus the Swissquote client ID, written by core banking at creation |
| KYC session mocked | Swissquote e-banking login + existing KYC |

**When the client pays a third party from the wallet, is Swissquote the sending institution?**

- **Arguments for "no":** the client initiates and authorises every payment with their passkey; the assets never belong to or pass through Swissquote; Swissquote cannot initiate or redirect a payment; the client can send the same payment without Swissquote (phone + kit). Swissquote's role resembles a security service that refuses dangerous payments.
- **Argument for "yes, partly":** Swissquote co-signs every standard payment and screens it, so a regulator could view it as *helping to transfer* the assets.
- **Our pragmatic answer:** treat co-signed payments as Swissquote-assisted. Swissquote already screens every co-signed recipient (sanctions list), and for payments to another regulated provider's hosted wallet it would attach originator data through a Travel Rule messaging protocol. Kit-signed payments (phone + kit) involve no Swissquote system at all. **This is the main open question for counsel.**

## 3. AML, sanctions and transaction policy

Implemented as real code in the share service (`services/share-service.mjs`), with mocked data sources:

| Control | Implementation | Production data source |
|---|---|---|
| Swissquote reads what it signs | Decodes the EVM transaction or Bitcoin PSBT itself and signs its **own** hash (the phone verifies the hash matches) | Same |
| Sanctions screening | Every recipient is checked against a sanctions list; a match returns `403` with the reason | Chain-analytics provider (e.g. Chainalysis, Elliptic) |
| High-value payments | Above 1 000 USDC the service answers `428` and the client must confirm explicitly | Thresholds set by compliance; fresh biometric + cooling-off for new recipients |
| Only the intended chain | EVM transactions for other chains than Base Sepolia are refused | Allow-list of supported chains |
| Recovery | Identity check (ID + liveness), 48 h waiting period, alerts, owner veto, audit events | Swissquote's video/ID verification, notification stack, audit log |

## 4. Data protection (revFADP)

Swissquote stores only what it needs: wallet ID, client name/ID, public key and addresses, the passkey's public key, Share B, recovery state and an event log. It never receives the passkey's private key, Share A, Share C or the kit password. Blockchain addresses linked to a client are personal data and are handled like account numbers.

**On-chain backup between friends** ([`onchain-backup.md`](onchain-backup.md)): the backup contract publicly shows which wallet addresses hold pieces for which wallet. The content is encrypted, but the link between the client's and friends' addresses is public and permanent. The client chooses to create it and the friends opt in, but for a launch counsel should review whether dedicated inbox addresses (not the friends' spending wallets) are needed. Friends never hold a usable share (the kit stays password-locked), so the custody analysis in §1 is unchanged.

## 5. Other points for the lawyer

- **Licence of the MPC library:** the prototype uses Silence Laboratories' Silent Shard (DKLs23) under a non-commercial licence; a launch needs a commercial licence.
- **Terms of use:** clients must understand that losing both the phone and the kit means losing the funds, and that Swissquote cannot reverse transactions.
- **Recovery obligations:** because a lost phone can only be recovered with Swissquote, the terms should commit Swissquote to process legitimate recoveries and describe the escrow arrangement for the case that Swissquote stops operating.

## Real vs. mocked

| Part | Prototype | Production |
|---|---|---|
| Client login and KYC | Mocked | Swissquote e-banking + KYC |
| Ownership by construction (key co-generation) | **Real** | Same, plus client ID in the record |
| Sanctions screening | Real policy, mock list | Chain-analytics provider |
| High-value confirmation | **Real** (`428` + explicit confirmation) | Plus fresh biometric and cooling-off |
| Identity check at recovery | Mocked (selfie match yes/no) | Video/ID verification |
| Notifications | Logged and shown in the app and presentation | Push, e-mail, SMS, e-banking |
