# backend/ — Services and mocks

Anything that cannot really be built during the hackathon is **mocked here and clearly labelled as a mock**.

| Component | Real or mock | Purpose |
|-----------|--------------|---------|
| Swissquote bank API | mock | Account linking, KYC status, fiat on/off ramp |
| Compliance service | mock | Sanctions screening, dApp allowlist, tx risk checks |
| [Guardian service](guardian/) | **mock** (real signatures, mocked ID check) | Links wallets to clients (ownership proof), Swissquote's recovery guardian |
| Bundler / paymaster | real (3rd-party) | Submitting UserOperations, sponsoring gas |

Each mock should have its own subfolder and a short README describing what the real system would be.

## Guardian service (`guardian/`)

```bash
cd backend/guardian && npm install && npm start   # http://localhost:8787
```

Runs as its own process and keeps its key in `guardian/data/` (git-ignored). The app never sees that key.

- `POST /wallets/link`: verifies a passkey signature from the wallet (ERC-1271 / ERC-6492), then links
  the wallet to the client profile. This is the ownership proof the Travel Rule asks for.
- `POST /recovery/identity`: **MOCK** of the ID document + face match. The policy is real: email and
  SMS codes alone are always refused.
- `POST /recovery/approve`: signs the EIP-712 recovery approval, bound to the on-chain nonce.

Every decision is appended to `guardian/data/audit.log`. Client notifications are logged, not sent (mock).
