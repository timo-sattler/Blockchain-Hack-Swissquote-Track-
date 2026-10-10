# Architecture

The wallet uses **2-of-3 threshold ECDSA (MPC)**. One key is generated in three shares: Anna's phone (A), the Swissquote share service (B) and a recovery kit she keeps herself (C). Any two shares sign together; the whole key never exists in one place. Because the result is an ordinary ECDSA signature, the same wallet works on Bitcoin and on every EVM chain.

![Architecture diagram](architecture.svg)

## Components

| Component | Real or mocked | Role | What the real version would be |
|-----------|----------------|------|--------------------------------|
| Swissquote app, Crypto tab (`app/`) | **Real** | UI, runs MPC party A, broadcasts transactions | Same, inside the native Swissquote app |
| Share A + passkey | **Real** | Phone's share. The passkey authorises every co-signature with Swissquote. Prototype: Share A is stored unencrypted in the browser | Share A encrypted with a key from the passkey (WebAuthn PRF) or kept in the platform keychain |
| Recovery kit (Share C) | **Real** | Share C encrypted with a client-chosen password (PBKDF2-SHA256, 310 000 iterations, AES-256-GCM), downloaded as a file for the client's cloud drive or USB stick | Same, with a password-strength policy |
| Guardian app (Share C, optional) | Planned | A relative holds Share C instead of the kit; no Swissquote account needed | Small companion app |
| Share service (Share B) | **Mocked**, separate Node process with its own storage | Co-signs payments, enforces limits and the recovery policy | Swissquote service in an HSM / secure enclave |
| Escrow agent (`services/escrow-agent.mjs`) | **Mocked**, separate Node process with its own storage | Holds a copy of Share B; stands in for Swissquote in one lost-share recovery only if Swissquote is gone and the client passes its identity check; deletes the copy afterwards | Swiss notary / trust company with an HSM, triggered by Swissquote's liquidation |
| Gasless relay | **Real** (Swissquote treasury key on Base Sepolia) | Submits EIP-3009 `transferWithAuthorization` signed by phone + Swissquote and pays the fee; per-wallet daily quota | Swissquote relayer / paymaster budget |
| Core banking | Mocked | Client ID, KYC status, CHF account | Swissquote core banking |
| KYC provider | Mocked | ID + liveness selfie during recovery | Swissquote's existing video/ID verification |
| Compliance | Mocked | Sanctions screening of recipient addresses | Chainalysis, Elliptic or similar |
| Notifications | Mocked | Alerts when recovery starts or a high-value payment is requested | Push, e-mail, SMS |
| Wallet registry | Partly real | The share service's wallet record links name, public key, addresses and passkey from the moment Swissquote co-generates the key ("ownership by construction", see `legal-compliance.md`); the client ID is mocked | Part of Swissquote's client database, with the client ID |
| Bitcoin testnet | **Real** | Signed SegWit transactions, balances via mempool.space API | Bitcoin mainnet |
| Base Sepolia (+ any EVM chain) | **Real** | Signed EVM transactions, USDC and ETH | Base / Ethereum mainnet and other EVM chains |
| Demo control room | **Real** (demo tool) | Shows live status and message flow of the real processes | Not part of the product |

The client app **never holds Share B**. Swissquote holds only one share and can neither move nor freeze funds on its own.

## Flows

1. **Wallet creation.** Anna opens the Crypto tab and registers a passkey with the share service (Face ID). Phone (A, also running party C locally) and share service (B) run distributed key generation. Share A stays on the phone (prototype: browser storage; production: encrypted with a passkey-derived key); Share C is encrypted with her password and downloaded as the recovery kit, never stored on the phone; Share B stays with the service. Because Swissquote co-generated the key in her session, its wallet record links her to the addresses from the start.
2. **Authentication and everyday signing.** Face ID unlocks Share A. The app logs in to the share service with its passkey, then phone and service run the MPC signing rounds. The service co-signs automatically for normal payments and asks for an extra confirmation above a threshold. The phone broadcasts the signed transaction.
3. **Signing without Swissquote.** If the service refuses or is gone, Anna loads her kit (C) and signs with phone + kit. No Swissquote involvement.
4. **Recovery (phone lost).** On a new phone Anna loads her kit and passes re-KYC (ID + selfie, mocked). During a 48 h delay (demo 30 s) every device that still holds the wallet shows a red alert, and her current passkey can **cancel** the recovery. Afterwards the new phone registers a passkey, and kit (C) and service (B) re-issue all three shares. Public key and addresses stay the same. She saves a new kit and deletes the old one. Details: `recovery.md`.
5. **Old phone locked out.** Each re-issue bumps the wallet's share generation (`epoch`). The old phone shows "This phone no longer controls the wallet", and the service refuses to co-sign with an outdated share (`409`). After a theft, an optional sweep to a brand-new key also makes the old phone share + old kit pair worthless.

## Status

| Part | State |
|------|-------|
| 2-of-3 key generation between app, share service and kit; passkey registration and login | **Built**, tested end to end |
| Co-signing with transaction decoding, mock sanctions screening, high-value confirmation | **Built**, tested |
| Signing with phone + kit when Swissquote is down | **Built**, tested |
| Recovery with mock re-KYC, attacker refusal, delay, new passkey, new kit, same addresses | **Built**, tested |
| Owner veto: alert on every device during the delay, cancel with the current passkey | **Built**, tested end to end with virtual passkeys |
| Replaced-device lockout: share epoch, lockout card, `409` on outdated shares | **Built**, tested end to end |
| Real broadcasts on Base Sepolia and Bitcoin testnet4 | Built; needs testnet funds in the wallet |
| Live presentation fed by the event hub | **Built**, tested (including killing the share service) |
| Kit replacement (phone + Swissquote re-issue all shares; old kit refused) | **Built**, tested end to end |
| Friend pieces: the password-locked kit split 2-of-3 with Shamir (audited library); recovery needs 2 pieces **and** the client's kit password | **Built**, tested end to end (two friends with a wrong password refused) |
| On-chain backup between friends ([`onchain-backup.md`](onchain-backup.md)): `KitBackupMailbox` contract, inbox keys signed by the friends' wallets, encrypted pieces and the locked kit on-chain, give-back to the new phone | **Built.** 11 Foundry tests; tested end to end on a local chain with Base Sepolia's chain ID; contract deployed on Base Sepolia (`0x52f4…C4dD`), live relays need a funded treasury |
| Escrow agent: recovery without Swissquote when the phone is lost | **Built**, tested end to end (attacker refused, same addresses, copy deleted) |
| Gasless USDC (EIP-3009, relayed, quota) | **Built**; signature accepted by Base Sepolia USDC; a funded wallet is needed to show a completed transfer |
| Share A encryption with WebAuthn PRF | Not built |
