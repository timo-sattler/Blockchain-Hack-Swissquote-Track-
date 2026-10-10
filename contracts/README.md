# contracts/ — On-chain backup of the recovery kit

`src/KitBackupMailbox.sol`: public mailbox for backing up a client's recovery kit with friends. It holds no funds, has no owner and stores only ciphertext. Friends register an inbox key signed by their own wallet; the client posts a signed backup (one encrypted piece per friend + the password-locked kit in chunks); friends give pieces back to the client's new phone. Design and threats: [`docs/onchain-backup.md`](../docs/onchain-backup.md).

Deployed on Base Sepolia: [`0x52f41590EE5bD2a9912A58433F1868482860C4dD`](https://sepolia.basescan.org/address/0x52f41590EE5bD2a9912A58433F1868482860C4dD).

```bash
npm install          # OpenZeppelin 5.4.0 (EIP712, ECDSA) and forge-std
forge test           # 11 tests
forge build && node ../services/deploy-mailbox.mjs   # deploy with the testnet key from ../.env
```
