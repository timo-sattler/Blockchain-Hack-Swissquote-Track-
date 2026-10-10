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

### Demo story (required)
**create a wallet → log in and sign a transaction → lose the wallet or its keys → recover access**, with a real transaction on testnet (tx hash + BaseScan link on screen). Roles A, B, C.

### The six required topics
| # | Topic | What we show | Where | Role |
|---|-------|--------------|-------|------|
| 1 | **Custody model + threat model** | Decision with pros/cons. Answer the three questions explicitly: who could **steal** funds, who could **lock the client out**, could Swissquote **alone or with a partner** move funds? | `custody-model.md`, `threat-model.md` | A, E |
| 2 | **Architecture** | Diagram: client app, backend services, key storage, contracts, chain, with **real vs. mocked** marked | `architecture.md` | D, E |
| 3 | **Wallet creation** | Passkey generated in the device secure enclave → smart account deployed → **linked to the Swissquote identity** (client logs into the mocked Swissquote account, wallet signs an ownership proof) | `app/`, `custody-model.md` | B, C |
| 4 | **Authentication** | Passkey + biometrics before every signature. **Small vs. high-value transaction must differ** (e.g. above CHF 1,000: second factor or delay). Now **required**, not just a bonus | `app/`, `contracts/` | B |
| 5 | **Recovery** | Lost / stolen / destroyed device. Who is involved, how long it takes, what stops an attacker. **Also: how the client gets funds back if Swissquote is permanently gone.** Bonus credit: demo shows recovery **refusing an attacker with stolen phone + email** | `recovery.md` | A, C |
| 6 | **Business case** | One concrete paragraph: revenue, assets kept in the ecosystem, new clients, lower costs | `business-case.md` | E |

### Technical constraints
- [ ] No homemade crypto: only established libraries (Safe / ERC-4337 tooling / WebAuthn). Homemade crypto is **penalised**.
- [ ] Every mock is labelled in the **demo and README**.
- [ ] **The mocked Swissquote guardian runs as a separate process with its own key storage.** The client app never holds the guardian key. (Explicit rule in the brief.)

### Legal (15 points, from the legal primer)
- [ ] State clearly: **custody or software?** Swissquote can't move funds alone → closer to software.
- [ ] Argue the **grey zone**: Swissquote + a partner together (our guardian recovery, the escrow path). See open decision in `custody-model.md`.
- [ ] **Travel Rule / ownership proof:** wallet signs an ownership proof at creation (EIP-1271), so transfers between the Swissquote account and the wallet are verified automatically.
- [ ] Answer: when the client pays a third party from the wallet, **is Swissquote the sending institution?** (Our answer: no, it's a self-hosted wallet; Swissquote isn't an intermediary in that transfer. Exception to discuss: the optional card.)

### Bonus (max. 10 points each, only if the demo story works)
| Bonus | Cheapest credible version | Role |
|-------|---------------------------|------|
| **Gasless transactions** | Paymaster sponsors USDC transfers. Explain **who pays** (Swissquote, as a client benefit / cost of acquisition) and **how abuse is prevented** (only verified wallets, rate limits, only allowlisted calls such as USDC transfers, or gas paid in USDC) | D |
| **Compliant dApp interaction** | Approved dApp list + sanctions screening (mock) + **simulation in plain language before signing** ("You send 20 USDC to Alice, balance after: 80 USDC") + extra checks above a threshold | B, D |
| *Optional: Swissquote card* | Not scored as a bonus. Only for the business case / pitch. See `docs/card-payments.md` | C, D |

### Submission text must include
- [ ] Custody model decision and threat model
- [ ] Architecture diagram with mocked parts marked
- [ ] Custody and Travel Rule handling
- [ ] How Swissquote makes money / what it gains
- [ ] Which bonus topics we tackled
- [ ] **Which AI tools we used, and what for** (keep a running list in `pitch/ai-tools.md`)

### Questions the judges will likely ask (prepare answers)
- **"ERC-4337 is EVM-only, what about Bitcoin?"** → Same design maps to Bitcoin natively with Miniscript: primary key + time-locked recovery keys (as in Liana wallet). Prototype focuses on EVM + USDC.
- **"Who pays gas?"** → Swissquote via paymaster, with abuse limits.
- **"Can Swissquote + the trusted contact steal funds?"** → They can start a key rotation, but 48 h time-lock + alerts + owner cancel. Discuss honestly as the residual risk.
- **"What if Swissquote disappears?"** → Owner passkey keeps working on-chain without Swissquote. Recovery via backup passkey + trusted contact (2 of 3) without Swissquote. Account usable from any Safe/4337 interface.

**Demo moment worth planning for:** attacker with phone + email starts recovery → KYC refuses them → real user gets the alert → cancels. That single scene covers custody, threat model and the recovery bonus credit.
