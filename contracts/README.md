# contracts/ — Smart contracts

Candidates (depends on the custody model we pick):

- **Smart account** (ERC-4337) with a passkey (P-256 / WebAuthn) signer
- **Recovery module**: guardians / time-lock / multi-factor recovery
- **Paymaster**: gasless transfers, e.g. paying gas in USDC (bonus)
- **Policy hooks**: dApp allowlist, limits for high-value transactions (bonus)

Use audited building blocks (e.g. existing 4337 account implementations) instead of writing crypto from scratch.

Tooling: TBD (e.g. Foundry). Target network: TBD testnet (e.g. Base Sepolia / Sepolia).
