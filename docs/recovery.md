# Recovery

Recovery always means **issuing a new phone share (Share A) for the same key**. The public key, the Bitcoin address and the EVM address stay the same, so no funds move and nobody has to be told a new address. Terms: [`handbook.md`](handbook.md).

## Who is involved

| Party | Role in recovery |
|---|---|
| Client | Has the recovery kit (Share C) and its password, passes the identity check, creates a passkey on the new phone |
| Swissquote share service (Share B) | Checks identity (mock), enforces the waiting period, alerts the client, joins the share re-issue |
| Old phone (if anyone still has it) | Sees a red alert and can **cancel** with its passkey |
| Trusted people (optional) | Each holds one **kit piece**; any 2 of 3 pieces give back the client's password-locked kit if the client lost it too. Without the client's kit password the pieces are useless, so they cannot perform a recovery themselves, not even together |
| Friends with an on-chain backup (optional) | Each holds one unlock piece in their Swissquote app, encrypted to their own inbox key; when the client sends a give-back link, they post the piece back on-chain, encrypted to the new phone. Two pieces + the kit password rebuild the kit. Details: [`onchain-backup.md`](onchain-backup.md) |
| Independent escrow agent (mock notary) | Holds a copy of Share B; steps in for Swissquote **only** if Swissquote is gone |

## Scenarios

| Scenario | What the client does | Time (production) | Swissquote needed? |
|---|---|---|---|
| Phone lost or broken | Recovery with kit + identity check | ~10 min of steps + **48 h** waiting period | Yes |
| Phone stolen | Same; afterwards the stolen phone is locked out | Same | Yes |
| New phone, old passkey still available (synced passkeys) | **Re-pair**: passkey login + kit issue a new phone share at once | ~1 min | Yes |
| Swissquote offline or gone, phone available | No recovery needed: phone + kit sign without Swissquote | Instant | **No** |
| Phone **and** e-mail/SIM compromised | Attacker is refused; client recovers normally | n/a | Yes |
| Kit lost or stolen, phone fine | **Replace the kit**: Face ID, then phone + Swissquote issue new shares; the old kit stops working | ~1 min | Yes |
| Phone **and** kit lost | Rebuild the kit from **2 of 3 friend pieces + the kit password** (piece files, or friends giving their pieces back on-chain), then normal recovery | Steps + 48 h | Yes |
| Phone lost **and** Swissquote gone | **Escrow agent** (after its own identity check) + kit rebuild the phone share; the agent then deletes its copy | Minutes (production: after Swissquote's liquidation is confirmed) | **No** |

## The flow, step by step

Demo values in brackets.

1. **Load the kit.** On the new phone: Crypto tab → *Lost your phone and passkey? Recover with your kit* → open the kit file, enter the password. The app decrypts Share C locally.
2. **Kit possession and identity check.** The kit (C) and Swissquote (B) sign a random, domain-separated recovery challenge; the service verifies the signature before starting recovery. This never sends Share C to the service and cannot sign a payment. ID document + liveness selfie are matched against the KYC profile (**mocked**: "Take selfie as Anna" or "Attacker with Anna's phone + e-mail"). A mismatch is refused with `403` and the client is alerted. A client-supplied matching identity flag without a valid kit proof is also refused.
3. **Waiting period: 48 h [30 s].** `POST /wallets/:id/recovery/request` records `readyAt`. Every device that still holds the wallet polls `GET /wallets/:id` and shows a red alert within seconds: *Someone is recovering this wallet on a new phone · This is not me · Cancel recovery*.
4. **Owner veto.** Cancelling needs a fresh passkey login (Face ID) on a device with the current passkey: `POST /wallets/:id/recovery/cancel`. The new phone immediately shows *Recovery cancelled*. The veto remains possible until MPC recovery successfully commits, including after the new phone stages its passkey. Cancelling invalidates an in-progress recovery session.
5. **Stage a new passkey.** After `readyAt`, the recovering device's private recovery token permits passkey registration (`POST /wallets/:id/passkey/options`, `POST /wallets/:id/passkey`). This stages a pending credential; the old passkey remains active. The token is never included in public wallet status.
6. **Re-issue the shares.** Kit (C, running on the new phone) and Swissquote (B) run DKLs lost-share recovery. Output: a new Share A for the phone, a new Share B for Swissquote, a new Share C for a new kit. The service checks that the public key did not change (`recovery produced a different key` otherwise), rechecks that the recovery has not been cancelled, then commits the new share, pending passkey and incremented **epoch** together. Old login tokens and pending signing sessions are invalidated.
7. **Save the new kit.** The app asks for a password and downloads the new kit, and tells the client to delete the old kit file.
8. **Old phone locked out.** The old phone sees the higher epoch and shows *This phone no longer controls the wallet*; Send is disabled. If it still tries, Swissquote refuses to co-sign: `409 This phone was replaced…`.

## What stops an attacker from using the same process

| Defence | Stops |
|---|---|
| Kit file **and** its password are required | Anyone without the client's own backup, including Swissquote itself and anyone with only the phone, e-mail or SIM |
| Identity check (ID + liveness) | Someone who stole the kit and guessed the password, but is not the client |
| E-mail and SMS are never a recovery factor | SIM swap and inbox takeover |
| 48 h waiting period with alerts on every device and channel | Silent takeovers: the real client has two days to notice |
| Owner veto with the current passkey | Any recovery the client did not start, as long as they still have a device |
| Share re-issue + epoch check | A stolen phone continuing to sign with Swissquote after the recovery |
| Every step is published to the event hub | Unnoticed recoveries during the demo; production writes the same events to an audit log |

**Bonus scenario: stolen phone and e-mail.** The attacker cannot even start: no kit, no password, face does not match. The demo shows the refusal live, and the presentation feed shows *Recovery requested with stolen phone + e-mail* followed by *Recovery refused*.

## Recovery without Swissquote

- **Phone still available:** phone + kit sign every payment without Swissquote (`signWithKit`, two shares on the device). The app offers this automatically when Swissquote does not answer. In the demo, stop the share service with Ctrl+C and send a payment.
- **Phone lost and Swissquote gone: escrow agent** (`services/escrow-agent.mjs`, mock notary, own process and storage). After every key generation Swissquote deposits a copy of Share B there (production: encrypted to the agent's HSM). The agent never signs payments and never hands Share B out. It steps in for Swissquote in exactly one protocol, the lost-share recovery, and only if:
  1. Swissquote has been unreachable for `ESCROW_OUTAGE_SEC` (demo 20 s; production: liquidation confirmed),
  2. the client passes the agent's own identity check (mocked), and
  3. the client holds a valid kit: the MPC protocol fails without Share C.

  Kit + escrow then issue a new phone share and a new kit; same addresses. The agent deletes its copy **after** the protocol succeeded. From then on the client signs with phone + kit; moving the funds to a new provider is recommended.

## Limits we state openly

- **Old shares still pair with each other.** After a recovery the old Share A and the old kit still form a valid pair offline. Swissquote cannot revoke an offline pair. Mitigations: the app tells the client to delete the old kit; after a theft, an optional *sweep* moves the funds to a brand-new key, which makes every old share worthless.
- **Recovery rules live in Swissquote's server.** They are not publicly auditable. Roadmap: an on-chain recovery registry (based on our deployed smart-account `RecoveryModule`) that records requests, friend approvals, the waiting period and vetoes; Swissquote's service would only join recoveries the contract approved.
- **Friends hold the data, the client holds the secret.** Two pieces only give back the kit locked with the client's password, so two colluding friends get nothing usable unless they also guess the password offline (slowed by PBKDF2, 310,000 rounds: a long password matters). Even then they would still need the identity check, the 48 h waiting period and the owner not cancelling. Pieces from the earlier format that did not need the password are refused.
- **Pieces and kit copies go stale.** Every recovery or kit replacement issues new shares; older kits and pieces then stop working, and the app asks for new ones.

## Evidence

- Headless Chrome run with virtual passkeys against the real services: create wallet → attacker refused → recovery requested → old phone alerted and cancelled with Face ID → new phone sees the cancellation → second recovery completes → old phone locked out → Swissquote answers `409` to a co-sign request with the outdated share generation.
- Second headless run: create → **replace kit** (old kit then refused with "This recovery kit is no longer valid") → phone and kit lost, kit **rebuilt from friend pieces 1 + 3** → recovered, same address → Swissquote stopped → **escrow** refuses an attacker, then recovers with kit + escrow, same Bitcoin and EVM addresses, deposit deleted.
- Server log lines for each step (`[share] recovery for … cancelled by the owner's passkey`, `[share] recover done …`) and the matching events in `/present.html#live`.
