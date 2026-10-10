# Recovery

**Model:** 2-of-3 guardians, a waiting period, and an owner veto, enforced by a smart contract
([`contracts/src/RecoveryModule.sol`](../contracts/src/RecoveryModule.sol)).

| Guardian | Who holds it | How it approves |
|---|---|---|
| Recovery kit | The client, offline (printed or on a USB stick) | Key in the kit file signs in the browser |
| Swissquote | Swissquote guardian service ([`backend/guardian`](../backend/guardian), **mocked**) | Signs only after an ID document + face match |
| Trusted contact | A person the client chooses, on their own phone | Opens a link, calls the client, sends back a code |

Any **2 of 3** approve a new passkey. The contract then waits (**72 h** in production, 60 s in the demo).
During that time any passkey the client still has can **cancel**. After the wait, anyone can finish the
recovery: the new passkey becomes the owner and **every old passkey is removed**.

## Scenarios

| Scenario | Who recovers | Time |
|---|---|---|
| Phone lost or broken | Recovery kit + Swissquote (after ID check) | ~10 min of steps + 72 h wait |
| Phone stolen | Same. The thief's passkey is removed at the end | same |
| Kit lost too | Swissquote + trusted contact | same |
| **Swissquote gone for good** | Recovery kit + trusted contact. No Swissquote server is needed: requests and approvals travel as a link and a code, and anyone can submit to the contract | same |
| Email and phone number compromised | Nothing happens: no guardian accepts email or SMS | n/a |

## Flow

1. **Setup (once):** the client links the wallet to their Swissquote profile with a passkey signature,
   downloads the recovery kit, and adds a trusted contact's guardian address. One passkey-signed
   transaction adds the module as an account owner and registers the guardians.
2. **Recovery:** on the new phone the client opens the kit (or logs in to Swissquote to find the wallet),
   creates a new passkey, and collects 2 approvals. Each approval is an EIP-712 signature over
   `(wallet, new passkey, nonce, deadline)`, checked in the app before anything is sent.
3. **Waiting period:** the contract records the request. Any device that still holds a passkey for the
   wallet shows a red warning with **Cancel**. Swissquote notifies the client on every channel.
4. **Finish:** the new passkey is added and the old ones are removed in the same transaction.

## Distinguishing the client from an attacker

- **Stolen phone + email:** the passkey needs Face ID, so the phone alone signs nothing. Email and SMS
  codes are never accepted by any guardian. Swissquote requires an ID document and a live face match, so
  the attacker gets 0 approvals. The demo shows this refusal ("Simulate attacker").
- **One guardian tricked:** not enough, the contract needs 2 (`threshold >= 2` is enforced on-chain).
- **Two guardians tricked or colluding:** the waiting period plus owner veto. The request is public on-chain
  and the client is alerted, so they can cancel with any device they still have.
- **Replay:** every approval is bound to the wallet, the exact new passkey, a nonce that changes after every
  start, cancel, or guardian change, and a deadline.
- **Malicious guardian griefing:** they cannot start a recovery alone. If a pair keeps restarting, the client
  replaces the guardians, which cancels anything pending.

## What Swissquote can and cannot do

- **Cannot** move funds, alone or with one partner. The module's code can only swap passkeys, and only
  through `startRecovery` → waiting period → `executeRecovery`.
- **Cannot** recover alone. Its approval is 1 of the 2 needed.
- **Can** refuse to approve (the client then uses kit + contact), and **can** stop sponsoring gas (the wallet
  falls back to paying gas itself).
- **Residual risk:** Swissquote and the trusted contact colluding while the client ignores the alerts for 72 h.
  This is why the contact should be someone the client chooses personally, not a Swissquote partner.

## Evidence

- `contracts/test/RecoveryModule.t.sol`: 12 tests on a Base Sepolia fork, against the real Coinbase Smart
  Wallet factory: both recovery paths, attacker key, single guardian, duplicate guardian, early execution,
  veto + replay, expiry, wrong key, threshold of 1, too-short delay.
- `scripts/e2e-recovery.mjs`: the whole story against the real guardian service on a local fork.
- `scripts/live-recovery.mjs`: the same story on Base Sepolia through the real bundler and paymaster.
  Example run (all gas sponsored, wallet holds 0 ETH):
  [setup](https://sepolia.basescan.org/tx/0x3ac07f83625957977c21fead23316f104760fce542838984ca9a703f2386480c) ·
  [collusion started](https://sepolia.basescan.org/tx/0x3b96fd49803e9addc100239d6ab918df076187d1a76f944749a9724b14e2b105) ·
  [vetoed by client](https://sepolia.basescan.org/tx/0x0708326d0081de41cdb5bb21d5c139848329bf87a4dbb308de0935336dc5bc89) ·
  [recovery started](https://sepolia.basescan.org/tx/0x04c185d8ceb969073e8deb43a72b6a46c70161ac4a38c8db93fbb28704d29550) ·
  [recovery finished](https://sepolia.basescan.org/tx/0x7c60cdd0fe6f3a9394b200e4a37de07b8d1d436c22fc08027b170b08693515a3)
