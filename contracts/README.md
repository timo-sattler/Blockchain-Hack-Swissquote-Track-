# contracts/ — Smart contracts

| Contract | Status | What it does |
|---|---|---|
| Coinbase Smart Wallet v1.1 | **Reused, audited** (factory `0xba5e…5842` on Base Sepolia) | The client's account, owned by a passkey |
| [`RecoveryModule`](src/RecoveryModule.sol) | **Ours** | 2-of-3 guardian recovery with a waiting period and owner veto. See [docs/recovery.md](../docs/recovery.md) |
| Paymaster | Reused (Pimlico, ERC-7677) | Sponsors gas |

`RecoveryModule` contains no custom cryptography: approvals are checked with OpenZeppelin's `EIP712`
and `SignatureChecker` (ECDSA keys and ERC-1271 smart accounts). It is not upgradeable and has no admin.

## Commands

Needs [Foundry](https://getfoundry.sh) and Node.

```bash
npm install                 # OpenZeppelin + forge-std
forge test -vv              # 12 tests on a Base Sepolia fork (real Coinbase Smart Wallet)

# Deploy (CREATE2: same address on every EVM chain). MIN_DELAY in seconds: 60 demo, 259200 production.
source ../.env && MIN_DELAY=60 forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
```

Demo deployment on Base Sepolia (MIN_DELAY=60), source verified on Sourcify (exact match):
[`0x1F039424e76238D89FC2EC7A1061F19AABf89d98`](https://sepolia.basescan.org/address/0x1F039424e76238D89FC2EC7A1061F19AABf89d98)
