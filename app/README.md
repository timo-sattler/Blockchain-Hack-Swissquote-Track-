# app/ — Wallet frontend

User-facing wallet. Planned flows:

- **Onboarding / wallet creation**: create the smart account and link it to the (mocked) Swissquote account
- **Authentication**: passkey / WebAuthn before every signature
- **Send**: build, simulate and sign a transaction, then send it to testnet
- **Recovery**: lost device → start and finish the recovery flow
- **Compliance UX**: warnings for unapproved dApps, high-value confirmations

Stack: TBD (e.g. Next.js + viem/wagmi + a 4337 SDK).
