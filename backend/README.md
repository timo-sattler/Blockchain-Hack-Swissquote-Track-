# backend/ — Services and mocks

Anything that cannot really be built during the hackathon is **mocked here and clearly labelled as a mock**.

| Component | Real or mock | Purpose |
|-----------|--------------|---------|
| Swissquote bank API | mock | Account linking, KYC status, fiat on/off ramp |
| Compliance service | mock | Sanctions screening, dApp allowlist, tx risk checks |
| Recovery / guardian service | TBD | Co-signer or guardian for recovery, without giving Swissquote control of funds |
| Bundler / paymaster | real (3rd-party) | Submitting UserOperations, sponsoring gas |

Each mock should have its own subfolder and a short README describing what the real system would be.
