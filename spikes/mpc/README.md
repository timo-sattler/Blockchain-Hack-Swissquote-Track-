# MPC spike: 2-of-3 threshold ECDSA for any chain

Validates [Silence Labs Silent Shard (DKLs23)](https://www.npmjs.com/package/@silencelaboratories/dkls-wasm-ll-node) for the wallet's custody model before building it into the app. All three parties run in one Node process here; in the product they are separate (phone, Swissquote share service, recovery kit).

```bash
cd spikes/mpc
npm install
node spike.mjs
```

## Parties

| Party | Holder | Used for |
|------:|--------|----------|
| 0 | Client phone (unlocked by passkey) | Every transaction |
| 1 | Swissquote share service | Automatic co-signing, recovery after re-KYC |
| 2 | Recovery kit (client) or a guardian | Recovery, or signing without Swissquote |

## Results (2026-10-10, Node 24, Windows laptop)

| Check | Result |
|-------|--------|
| Distributed key generation, 2-of-3 | PASS, ~4 s, ~247 KB per share, 33-byte public key |
| Phone + Swissquote, phone + kit, Swissquote + kit each sign | PASS, ~0.1 s per signature |
| One key gives an EVM address and a Bitcoin testnet address | PASS |
| EIP-1559 transaction (Base Sepolia) signed, sender recovers to wallet address | PASS |
| Bitcoin SegWit transaction signed and finalized (BIP143 sighash) | PASS |
| Phone lost: Swissquote + kit rebuild a new phone share, same public key and addresses | PASS, ~4 s |
| Old phone share + refreshed Swissquote share | Fails, as intended |
| Old phone share + **old** kit share | **Still signs** |

Not tested yet: broadcasting real transactions (needs testnet funds), the browser build (`dkls-wasm-ll-web`), networking between processes.

## What this means for the design

- **Multi-chain works.** The same MPC key signs for Bitcoin and every EVM chain, so one recovery covers all assets.
- **Recovery keeps the address but not the old shares' validity among themselves.** The underlying key does not change, so any two *old* shares still form a valid pair. During recovery the client must store the new kit and destroy the old one. The stolen phone share is encrypted behind the passkey, so it is useless alone.
- **For a stolen phone, offer a sweep:** generate a brand-new key and move the funds there. This revokes every old share for certain, at the cost of new addresses.
- **Shares are large (~247 KB).** Fine for device storage and a backup file, too big for a QR code. The paper kit would hold an encryption key, the encrypted share lives in the client's cloud drive.

## License notice

This spike uses Silence Laboratories' Silent Shard library under the **Silence Laboratories Non-Commercial Use License** (see `node_modules/@silencelaboratories/dkls-wasm-ll-node/LICENSE.md`). Fine for research and a hackathon prototype; a product launch by Swissquote would need a commercial license from Silence Laboratories.
