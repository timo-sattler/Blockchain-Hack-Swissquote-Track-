# Legal & compliance (Switzerland)

> Simplified engineering reasoning, not legal advice. Based on the legal primer in `challenge-brief.md`.

## Custody or software?

Custody depends on **who can move the funds**. In our design Swissquote cannot move client funds on its own:
- Swissquote holds only a guardian key that can approve a key rotation, never a transfer.
- It is 1 of 2 required approvals, and every recovery has a public time-lock with owner veto.

So the wallet is closer to **software than custody**. Remaining grey zones, argued in `custody-model.md`:
- Swissquote + trusted contact together (guardian recovery): time-lock + owner cancel.
- Escrow path (inactivity): open decision (independent partner and/or opt-in).
- Optional card: Swissquote can pull up to a user-set daily limit, like a direct debit mandate the client can revoke instantly.

## Travel Rule and wallet ownership verification

Under FINMA's rules, a Swiss bank may only send crypto to, or receive it from, an external wallet after verifying who owns it.

**How our wallet makes this automatic:**
1. At wallet creation the client is logged into their Swissquote account (KYC done).
2. The smart account signs an **ownership proof** message (EIP-1271 signature, verified on-chain) that links the wallet address to the client.
3. Swissquote stores `client ID ↔ wallet address` as a verified self-hosted wallet.
4. Transfers between the Swissquote account and this wallet need no manual check.

**When the client pays a third party from the wallet:** Swissquote is **not** the sending institution. The client signs and sends from their own self-hosted wallet; Swissquote is not an intermediary in that transfer. (Exception to discuss: the optional card, where Swissquote settles the payment.)

## AML / sanctions screening

- Recipient addresses are screened against sanctions lists before signing (mock compliance service), with a warning or block in the UI.
- dApp interactions are checked against an approved list.
- In production: a real chain-analytics / screening provider.

## Real vs. mocked

| Part | Prototype | Production |
|------|-----------|------------|
| KYC / Swissquote identity | Mock login | Swissquote e-banking + video ident |
| Ownership proof | **Real** EIP-1271 signature | Same |
| Sanctions screening | Mock list | Chain-analytics provider |
