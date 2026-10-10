# Blockchain-Hack-Swissquote-Track — Swissquote Wallet Challenge

A self-custody wallet Swissquote could realistically launch for its clients: **their keys, their control**, while staying one step away from their Swissquote account.

The demo must cover the full lifecycle **create → authenticate → sign & send (testnet) → lose access → recover**.

Full challenge text: [`docs/challenge-brief.md`](docs/challenge-brief.md) · Weekend plan and checklist: [`PLAN.md`](PLAN.md)

## Team

| Person  | Focus area (to be agreed) |
|---------|---------------------------|
| Vincent | TBD |
| Maxi    | TBD |
| Grace   | TBD |
| Jeroen  | TBD |
| Timo    | TBD |

## Repository structure

```
.
├── app/         Wallet frontend: onboarding, passkey auth, send, recovery UI
├── contracts/   Smart contracts: smart account, recovery module, paymaster
├── backend/     Services + clearly marked mocks (Swissquote bank, compliance, guardians)
├── scripts/     Deployment and demo scripts (testnet)
├── docs/        Custody model, threat model, architecture, recovery, legal, business case
├── pitch/       Slides, demo script, screenshots
└── members/     Personal scratch folder per team member
```

Each folder has its own README describing what belongs there.

## Judging criteria → where it lives

| Criterion | Points | Main location |
|-----------|-------:|---------------|
| Technical implementation | 35 | `app/`, `contracts/`, `backend/` |
| Security & custody design | 20 | `docs/custody-model.md`, `docs/threat-model.md`, `docs/recovery.md` |
| Legal feasibility | 15 | `docs/legal-compliance.md` |
| Business case | 15 | `docs/business-case.md` |
| UX & pitch | 15 | `app/`, `pitch/` |
| Bonus: gasless tx, compliant dApp interaction | +20 | `contracts/` (paymaster), `backend/compliance` |

Bonus points only count if the core create → sign → recover flow works end to end, so that comes first.

## Workflow

1. **Never push directly to `main`.** Create a branch per task:
   ```
   git checkout main && git pull
   git checkout -b <name>/<short-task>     # e.g. grace/passkey-login
   ```
2. Commit small and often, then push your branch:
   ```
   git push -u origin <name>/<short-task>
   ```
3. Open a Pull Request on GitHub; one teammate reviews, then merge.
4. Pull `main` regularly to stay in sync.

Secrets (private keys, API keys, RPC URLs) go into `.env` (git-ignored). Copy `.env.example` to `.env` and fill it in. **Never commit real keys.**
