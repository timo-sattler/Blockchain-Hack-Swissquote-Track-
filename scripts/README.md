# scripts/ — Deployment and demo

```bash
npm install
npm run e2e:recovery   # whole recovery story on a local Base Sepolia fork (needs Foundry)
npm run live:recovery  # same story on the real Base Sepolia, gas sponsored (needs VITE_PAYMASTER_URL in app/.env.local)
```

`live-recovery.mjs` sends every step as a real UserOperation through the bundler and paymaster, exactly
like the app: setup batch, a vetoed collusion attempt, and a recovery submitted from the new phone's
helper account. It prints a basescan link for each transaction.

`e2e-recovery.mjs` starts anvil, deploys `RecoveryModule`, starts the guardian service, creates a real
Coinbase Smart Wallet, and checks: ownership proof, guardian setup, attacker refused, Swissquote +
contact collusion vetoed by the client, lost phone recovered, thief's old key revoked.
A local key stands in for the passkey (real passkeys need a browser).

Contract deployment: see [contracts/README.md](../contracts/README.md).
