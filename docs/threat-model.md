# Threat model

Scope: the two-part wallet as built in this repository (the client's part A on their devices, Swissquote's part B in the share service, a copy of B at the escrow agent). Design: [`custody-model.md`](custody-model.md). Key terms: [`handbook.md`](handbook.md).

## Assets

| Asset | Where | Why it matters |
|---|---|---|
| Client funds (BTC, ETH, USDC, EURC) | Bitcoin testnet4 and Base Sepolia, at addresses derived from the shared public key | The thing to protect |
| Part A | Each of the client's devices (browser storage in the prototype) | Needed for every signature |
| Part B | Share service storage | Needed for every signature |
| Copy of B | Escrow agent storage | Released only after the grace period |
| Passkeys | Each device's passkey manager (iCloud Keychain, Google Password Manager, Windows Hello) | Swissquote only co-signs after a passkey login from a registered device |
| Add-a-device link | Shown once as a QR code / link on a device that has part A | Contains the one-time key for an encrypted copy of A |
| Fee account (treasury) | Swissquote | Pays the gas of sponsored USDC/EURC transfers |

**Rule:** moving money needs part A **and** part B. Each row below is about how an attacker would get both, and what stops them.

## Attackers and attack paths

| # | Attacker / event | Has | Tries | What stops them | Residual risk |
|---|---|---|---|---|---|
| 1 | Thief with a **locked** device | The device | Pay | Swissquote co-signs only after the device's passkey (Face ID); the client removes the device from another one | None while the device stays locked |
| 2 | Thief with an **unlocked** device | Part A, maybe the passkey | Pay | Every payment still passes Swissquote's screening and the high-value confirmation; the client removes the device, after which Swissquote refuses its passkey | Small payments to unlisted addresses until the device is removed. Production: part A encrypted with the passkey (WebAuthn PRF) |
| 3 | **Phishing** site | A fake page | Get a passkey signature | Passkeys are bound to the real domain; they do not work on a look-alike | None |
| 4 | **Malicious Swissquote insider** or a breach of the share service | Part B | Sign alone | Two-party ECDSA: impossible without part A. Tested, and demonstrated on the real database (`npm run insider`) | None for signing; the insider could refuse service (see #9) |
| 5 | Share service **tampered with** to sign another transaction | Control of the service | Return a hash for a different payment | The app builds the transaction itself and aborts if Swissquote's hash differs | None |
| 6 | **Compromised app frontend** | Code next to part A | Exfiltrate part A or show a fake recipient | Part A alone cannot sign; screening still applies | Real for any app; production: code signing, app-store distribution, part A in the keychain |
| 7 | Payment to a **scam or sanctioned address** | The client's trust | Trick the client into paying | Swissquote screens every recipient before it signs (mock list; production: a chain-analytics provider) | Addresses not yet on any list |
| 8 | **Leaked add-a-device link** | The link within 10 minutes | Add their own device | Single use, 10 minutes, shown as a QR code; every added device appears in the device list and the live feed and can be removed | A short window if the link is shared carelessly |
| 9 | **Swissquote unreachable or insolvent** | Nothing | — | The wallet pauses; after the grace period the escrow agent releases its copy of B to a device that proves it holds A | Funds are inaccessible during the grace period |
| 10 | **Malicious escrow agent** | Copy of B | Sign alone, or with Swissquote | It holds the *same* part as Swissquote: together still one part. Releases only after the grace period, only to a device that co-signs a fresh challenge with part A | None for signing |
| 11 | **Replay** of a login or a signing session | Captured traffic | Reuse it | Challenges are single-use and expire after 5 minutes; a login token authorizes one transfer; signing sessions are single-use | None |
| 12 | **Abuse of gas sponsoring** | A wallet | Drain Swissquote's fee account | Only logged-in clients, only the authorization approved in that login, only USDC/EURC, a daily cap per wallet, quota reserved before any network call | Bounded by the cap |

## What the automated tests prove

`cd services && npm test` (21 tests; real MPC and real WebAuthn verification against the share service in its own process, with disposable storage and a local network stub):

- Wallet creation needs its private session token; the key is created once; Swissquote's stored part is party 1 and differs from the client's.
- Login challenges cannot be replayed; parallel prompts keep separate challenges.
- Co-signing needs a passkey login and yields a valid signature for the wallet; one login authorizes one transfer only.
- Malicious recipients are refused before a signing session exists.
- Adding a device needs a login, a single-use invite and the new device's own passkey; Swissquote only ever relays the encrypted copy; the added device co-signs with its identical copy.
- A removed device can no longer log in and its open sessions are revoked; the last device cannot be removed.
- The gasless relay rejects malformed, unapproved, unknown-token and sanctioned authorizations before spending gas; sponsored USDC and EURC obey the daily cap.
- Custody proof: Swissquote alone, Swissquote + the escrow copy, or Swissquote + a forged client part cannot produce a valid signature.

## Lock-out risks (losing access without an attacker)

| Event | Effect | Mitigation |
|---|---|---|
| One device lost | None: the other devices keep working | Remove it; add a new device from another one |
| Every device lost | Wallet lost | The app suggests a second device right after creation |
| Swissquote down for hours | Wallet paused | Wait; nothing is lost |
| Swissquote gone for good | Wallet paused for the grace period | Escrow agent releases its copy of B |
| Escrow agent gone too | Wallet stuck | Production: escrow with a regulated notary, copy in an HSM, contractual duty |

## Out of scope / accepted for the prototype

- Part A is not encrypted at rest (see #2).
- Client login, KYC and the list of malicious addresses are mocks. The **policies** around them are real code in `services/share-service.mjs`.
- The share service is one Node process with file storage, not an HSM. The escrow deposit uses a shared demo token.
- Testnets only; the demo tunnel (`*.trycloudflare.com`) is public while it runs.
