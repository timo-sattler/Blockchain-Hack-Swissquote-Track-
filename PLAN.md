# Weekend plan — Swissquote Wallet Challenge

> **Assumption:** submission is **Sunday ~14:00**. If the real deadline is different, shift every block by the same amount.
> Goal for the weekend: **one demo that works end to end** (create → authenticate → sign & send on testnet → lose access → recover). Bonus points only count when that works, so we only start bonus work once it does.

---

## 1. Decisions to make at kickoff (max. 45 min)

| # | Decision | Suggested default (change it if someone knows better) |
|---|----------|------------------------------------------------------|
| 1 | Testnet | **Base Sepolia** (cheap, good 4337 support, faucets) |
| 2 | Custody model | ✅ **Decided:** ERC-4337 smart account, passkey signer on the user's device. Swissquote holds **no key that can move funds** |
| 3 | Account implementation | Use audited building blocks. Options: **Safe + Safe4337Module + passkey signer** or **ZeroDev Kernel + WebAuthn validator**. Choose whichever someone gets deploying fastest; don't write your own crypto |
| 4 | Recovery model | ✅ **Decided:** guardians (2 of 3: Swissquote after KYC / backup passkey / trusted contact) + 48 h time-lock with owner cancel, **plus** time-delayed escrow: after 180 days of inactivity Swissquote can start a recovery with a 30-day time-lock (owner can cancel). See `docs/custody-model.md` and `docs/recovery.md` |
| 5 | Bundler / paymaster | Pimlico or ZeroDev (free testnet tier), via `permissionless` / viem |
| 6 | Frontend | Next.js + viem (+ wagmi if helpful) |
| 7 | Contracts tooling | Foundry |

Decisions 2 and 4 are written up in `docs/custody-model.md` and `docs/recovery.md`. Role A: the recovery module needs guardians + threshold, time-lock + owner cancel, an inactivity timer (`lastActivity`, reset by owner transactions) and the escrow path.

---

## 2. Roles (5 people)

Fill in names at kickoff based on who is strong at what. One owner per role, and everyone helps where the critical path is blocked.

| Role | Owns | Folders | Owner |
|------|------|---------|-------|
| **A. Smart account & recovery** | Deploy the account factory, passkey signer, recovery module (guardians + time-lock + cancel), tests | `contracts/`, `scripts/` | |
| **B. Wallet app: core flow** | Onboarding (create passkey + account), authentication, send screen (build → simulate → sign → submit → show tx on explorer) | `app/` | |
| **C. Recovery UX + backend mocks** | "Lost my phone" flow in the app, guardian approval screens, mocked Swissquote bank API (account linking, KYC status), guardian service | `app/` (recovery), `backend/` | |
| **D. Infra, integration, bonus** | `.env`, bundler/paymaster setup, faucet funding, end-to-end demo script. Later: **gasless tx via paymaster** and the **compliance mock** (dApp allowlist, sanctions check, high-value warning) | `scripts/`, `backend/compliance`, `contracts/` (paymaster) | |
| **E. Security, legal, business, pitch** | Threat model, legal/FINMA, business case, slides, demo script, backup recording. **This is ~45 % of the points**: treat it as a full role, not leftover work | `docs/`, `pitch/` | |

A and E should spend 30 minutes together Saturday afternoon so the custody and threat-model docs match what is actually built.

---

## 3. Timeline

### Saturday
| Time | What | Done when |
|------|------|-----------|
| 11:15–12:00 | **Kickoff**: decisions above, assign roles, everyone creates a branch | Tables in §1 + §2 filled in |
| 12:00–14:30 | **M1 – skeletons** | A: account deploys on Base Sepolia · B: passkey created in browser · C: mock API runs · D: bundler works with a funded test key · E: outline of all docs |
| 14:30 | 15-min sync | |
| 14:30–19:00 | **M2 – core flow** | Create account with passkey → send testnet ETH/USDC → tx visible on BaseScan, **from the app** |
| 19:00 | Sync. **If M2 isn't working, everyone helps with M2** | |
| 19:00–24:00 | **M3 – recovery** | Lose device → guardians approve → time-lock → new passkey controls the account; old key can cancel during the window |
| ~24:00 | Merge everything to `main`, tag `core-demo` | |

### Sunday
| Time | What | Done when |
|------|------|-----------|
| 08:30 | Sync, bug list | |
| 08:30–11:00 | **Bonus**: gasless send (paymaster) + compliance checks · **Docs final** | |
| 11:00 | **Feature freeze.** Only bug fixes from now on | |
| 11:00–13:00 | Slides final, **rehearse the demo 3×**, record a backup video of the full flow | Demo fits the time slot |
| 13:00–14:00 | Buffer → submit | |

---

## 4. If we fall behind, cut in this order
1. Card payments (optional; keep it as a slide + mockup)
2. Compliance mock (bonus)
3. Gasless paymaster (bonus)
4. Polished UI (keep it functional)
5. Real guardian service → hard-code guardian approvals in a script
6. **Never cut:** create → sign → send → recover, plus the custody/threat/recovery docs

---

## 5. Pitch storyline (for role E)
1. Problem: clients who want self-custody have to withdraw and leave Swissquote; losing a seed phrase = losing everything.
2. Solution: passkey wallet with no seed phrase, recovery via guardians + time-lock, still one tap away from the Swissquote account.
3. **Live demo** (the full lifecycle, including the attacker scene in §7).
4. Why it's safe: Swissquote can never move funds alone (show the custody table).
5. Why it's legal: self-custody rather than custody by Swissquote; wallet ownership verification and AML at the bank boundary.
6. Why Swissquote should build it: retention, revenue (swaps, ramps, premium recovery, **card interchange**), lower support cost.

---

## 6. Working rules
- Branch per task (`<name>/<task>`), PR + 1 review, never push to `main` (see README).
- Mocks are **labelled as mocks** in code, UI and pitch.
- No real keys in git. Ever.
- Blocked for >30 min? Say so in the group chat.

---

## 7. Brief → checklist (full text in `docs/challenge-brief.md`)

Tick these off before Sunday's feature freeze. The judges will look for each one by name.

### Must-haves
| Requirement from the brief | How we show it | Role |
|----------------------------|----------------|------|
| Full lifecycle: create → authenticate → sign → loss of access → recovery | One continuous live demo + backup video | A, B, C |
| **Real transaction** on a blockchain (testnet OK) | Tx hash + BaseScan link on screen | B, D |
| Clear, **defended** custody model | `custody-model.md`: decision + comparison table vs. MPC / seed phrase / Shamir | A, E |
| Where keys / key shares live | Key table: passkey in device secure enclave, guardian keys, Swissquote's recovery-only role (can't move funds) | A, E |
| Secure authentication **before** signing | Passkey biometric prompt on every send (WebAuthn `userVerification: "required"`) | B |
| Credible threat model | `threat-model.md` table, including a **malicious Swissquote insider** | E |
| Wallet architecture | Diagram in `architecture.md` with real vs. mocked labels | D, E |
| Recovery that **doesn't give Swissquote control** | Swissquote = 1 of N guardians, never enough alone; time-lock + cancel | A |
| Established crypto libraries, no own crypto | List the libraries in `architecture.md` (Safe/ZeroDev, viem, WebAuthn) | A |
| Mocks **clearly documented** | `backend/*/README.md` + "MOCK" badge in the UI | C |

### Bonus (in priority order)
| Bonus | Cheapest credible version | Role |
|-------|---------------------------|------|
| **Recovery that tells the real user from an attacker with the phone or email** | Recovery needs factors a phone/email compromise doesn't give: Swissquote KYC re-check (bank login + 2FA / video ident, mocked) + backup passkey or trusted contact. Then a time-lock with alerts on every channel; the old key can cancel. Email/SMS alone never count. Explain it as an attack-by-attack table | A, C, E |
| **Gasless USDC transfer** | Paymaster sponsors the UserOp (or ERC-20 paymaster: gas paid in USDC). Demo: brand-new account with 0 ETH sends USDC | D |
| **Transaction simulation** | Simulate before signing and show "you will send X USDC to Y" + balance change | B, D |
| **Approved dApp list / sanctions screening** | Mock compliance API: allowlist + sanctioned-address list; sending to a "sanctioned" address is blocked live in the demo | D |
| **High-value checks** | Above e.g. CHF 1,000 → extra confirmation (second passkey or delay) | B |
| **Wallet ownership verification (Swiss)** | Smart account signs a message (EIP-1271) to prove ownership to Swissquote, which banks need for transfers to/from self-hosted wallets (FINMA travel-rule guidance; check the exact reference) | D, E |
| **Optional: Swissquote card** | Daily USDC spending limit in a contract + mock card terminal: one payment approved, one declined, then freeze. See `docs/card-payments.md` | D (contract), C (mock UI) |
| **Strong business case** | Numbers slide: retaining clients who would otherwise withdraw, revenue from swaps/ramps/premium recovery, lower support cost | E |

**Demo moment worth planning for:** attacker steals phone + email → starts recovery → real user gets the alert → cancels. That single scene covers custody, threat model and the recovery bonus.
