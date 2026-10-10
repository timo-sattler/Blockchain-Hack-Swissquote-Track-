# Threat model

Scope: the 2-of-3 MPC wallet as built in this repository (phone = Share A, Swissquote share service = Share B, recovery kit = Share C). Key terms: [`handbook.md`](handbook.md). Design: [`custody-model.md`](custody-model.md).

## Assets

| Asset | Where | Why it matters |
|---|---|---|
| Client funds (BTC, ETH, USDC) | Bitcoin testnet4 and Base Sepolia, at addresses derived from the shared public key | The thing to protect |
| Share A | Phone (browser storage in the prototype) | One of three shares |
| Share B | Swissquote share service storage | One of three shares |
| Share C | Password-encrypted kit file | One of three shares; the only way to recover a lost phone |
| Passkey | Phone's secure element / passkey manager | Swissquote only co-signs after a passkey login |
| Kit password | Client's memory | Decrypts Share C |
| Wallet record | Share service | Links client, addresses, passkey; drives recovery |

**Rule of thumb:** an attacker needs **two shares** to move money. Every row below is about which two shares, and what stands in the way.

## Attackers and attack paths

| # | Attacker / event | What they have | What they can do | What stops them | Residual risk |
|---|---|---|---|---|---|
| 1 | Thief with a **locked** phone | Device | Nothing | Device lock; Swissquote requires a passkey login (biometrics) before co-signing | None |
| 2 | Thief with an **unlocked** phone | Share A (+ passkey if biometrics bypassed) | Prototype: read Share A from browser storage. Ask Swissquote to co-sign only with the passkey | Passkey login per payment; sanctions screening and high-value confirmation; client starts recovery, which issues new shares and locks the phone out (Swissquote refuses its outdated share with `409`) | Production must encrypt Share A with the passkey (PRF) so an unlocked phone is not enough |
| 3 | Attacker with **phone + e-mail + SIM** (bonus scenario) | Share A, inbox, SMS | Try a recovery to their own phone | Recovery needs **the kit file and its password** (Share C) **and** a matching ID document + liveness selfie. E-mail and SMS codes are never accepted. Demo: refused with "the selfie does not match the client on file" | None for this combination |
| 4 | Thief of the **kit file** | Encrypted Share C | Offline password guessing | PBKDF2-SHA256 with 310 000 iterations per guess; the kit alone is one share; a recovery would still need the identity check, the waiting period, and the owner not cancelling | Weak passwords: enforce strength in production |
| 5 | Thief with **phone + kit + kit password** | A + C | **Can sign without Swissquote** (two shares) | Nothing cryptographic. The kit must not live on the phone, and the password must not be saved with it. The app tells clients this at backup time | Accepted: equivalent to losing both keys of a two-key safe |
| 6 | **Malicious Swissquote insider** or a breach of the share service | Share B | Co-sign nothing without a second share; start no recovery without Share C | 1 of 3 shares; recovery needs the client's kit; production: HSM with dual control and audit log | Insider **plus** a stolen kit and password = theft (see #5) |
| 7 | Swissquote service **tampered with** to sign a different transaction | Share B, control of the service | Return a hash for a transaction the client did not approve | The phone recomputes the hash of its own transaction and aborts if Swissquote's hash differs (`sameHash` check in `flows.ts`) | None |
| 8 | **Compromised app frontend** (supply chain, malicious update) | Code running next to Share A | Exfiltrate Share A or show a fake recipient | Out of scope for the prototype. Production: native app, code signing, reproducible builds, Swissquote screening still sees the real recipient | Real risk for any wallet app |
| 9 | Payment to a **sanctioned address** or an obvious scam | n/a | Client is tricked into sending | Swissquote decodes every co-signed transaction and blocks recipients on the sanctions list (mock list in `share-service.mjs`); `403` with a clear reason | Kit-signed payments (A + C) bypass screening by design |
| 10 | **Social engineering of Swissquote support** to approve a recovery | Persuasion | Get a recovery started | Recovery still needs the kit (Share C); every request alerts all of the client's devices; the **current passkey can cancel** during the 48 h waiting period | If the attacker also has the kit, the waiting period and alerts are the last line of defence |
| 11 | **Replay** of an old login or co-signing session | Captured traffic | Reuse it | Login tokens expire after 5 minutes and are bound to one wallet; signing sessions are single-use and bound to the hash Swissquote computed | None |
| 12 | Old phone keeps working **after a recovery** | Old Share A | Sign with Swissquote | Recovery and pairing re-issue all shares and bump the wallet's `epoch`; Swissquote refuses co-signing with an older epoch (`409`) and the old phone shows a lockout card | Old Share A + **old** kit still pair offline (see #5); client must delete the old kit |
| 13 | **Two trusted friends collude** (kit pieces) | The password-locked kit | Guess the kit password offline, then start a recovery or, with a Swissquote insider (Share B), sign directly | Two pieces only give back the **password-locked** kit: without the client's password they get nothing usable (tested). One piece alone cannot even be attacked (Shamir). Password guessing is slowed by PBKDF2 (310,000 rounds). A recovery still needs the identity check, the 48 h waiting period and no owner veto; **replacing the kit** makes all pieces worthless | Two friends who also crack a weak kit password, plus a Swissquote insider |
| 14 | **Malicious escrow agent** | Copy of Share B | Same as a Swissquote insider | Steps in only after Swissquote has been unreachable for the outage period and the client passes its identity check; needs the client's kit (protocol fails otherwise); deletes its copy afterwards; production: HSM under a notary contract | Escrow + kit thief, only once Swissquote is gone |
| 15 | **Abuse of gasless sponsoring** | A wallet | Drain Swissquote's gas budget | Relay only for a logged-in client, only this wallet's own USDC, only the exact authorization Swissquote screened in that login; persistent daily quota per wallet; duplicate nonces refused | Bounded by the quota |

| 16 | **Swissquote swaps a friend's inbox key** (on-chain backup) | Share B, the relay | Collect friends' pieces by encrypting them to its own key | The contract accepts an inbox key only with a signature from the friend's own wallet (phone + Swissquote); Swissquote cannot sign alone. Tested in Foundry | None for a single party |
| 17 | **Fake give-back link** sent to friends | Social engineering | Get pieces encrypted to the attacker's one-time key | 6-digit safety code on both phones, checked by phone call; even two fooled friends only yield the password-locked kit | Two fooled friends + a weak kit password |
| 18 | **Spam on a give-back request** | Anyone | Fill the request with garbage | Unreadable pieces ignored; contract caps 8 per request; relay rate-limited; client makes a new request | Denial of service only |

Details of the on-chain backup: [`onchain-backup.md`](onchain-backup.md).

## Lock-out risks (losing access without an attacker)

| Event | Result | Way back |
|---|---|---|
| Phone lost, kit safe | Temporary | Recovery: kit + Swissquote (identity check, 48 h) |
| Kit lost, phone safe | No immediate impact | **Replace kit** (built): Face ID, then phone + Swissquote issue new shares and a new kit; the old kit stops working |
| Swissquote offline or refuses | No impact on spending | Phone + kit sign without Swissquote |
| Phone lost **and** Swissquote gone | Temporary | **Escrow agent** (built, mock) + kit rebuild the phone share |
| Phone lost **and** Swissquote still operating but refusing | Locked out | Contractual recovery obligation; escrow only steps in when Swissquote is gone |
| Phone **and** kit lost | Temporary, if pieces exist | Kit rebuilt from **2 of 3 friend pieces + the client's kit password** (built), then normal recovery. Without pieces or without the password: funds lost |
| Passkey deleted, phone fine | Cannot co-sign with Swissquote | Sign with phone + kit, or recover |

## Out of scope / accepted for the prototype

- Share A is not encrypted at rest (documented, see #2).
- Identity check, notifications and the sanctions list are mocks. The **policies** around them (what is required, what is refused, what is alerted) are real code in `services/share-service.mjs`.
- Testnets only; no real funds.
- The share service is one Node process with file storage, not an HSM.
- The demo tunnel (`*.trycloudflare.com`) is public while it runs.
