# Threat model

Scope: the wallet as built in this repository: Part A on the client's devices, Part B in the share vault (copy at the notary escrow), Part C encrypted under the paper Recovery Card. Design: [`custody-model.md`](custody-model.md).

## What we protect

| Asset | Where | Why it matters |
|---|---|---|
| The client's funds (ETH, USDC, EURC; BTC address from the same key) | The client's address on Ethereum (Sepolia in the demo) | The thing to protect |
| Part A | Each of the client's devices, encrypted (passkey PRF or wallet password); an encrypted backup at Swissquote and in the backup file | One of the two parts for every payment |
| Part B | Share vault; copy at the notary | Swissquote's part |
| Part C | Encrypted, at the vault, the notary, each device and in the backup file; its key is the paper card | The client's spare part |
| Approval of a payment | Passkey signature over the exact payment, SMS above the threshold | What lets the vault co-sign |

## Attackers

| # | Attacker | Has | Wants | What stops them | Left over |
|---|---|---|---|---|---|
| 1 | **Thief with the unlocked phone** | Device with encrypted A | Pay | Part A opens only with Face ID; every payment needs a fresh Face ID approval checked by the bank | A thief who can also pass Face ID; the client revokes the device from another device or in eBanking ("Report lost") |
| 2 | **Thief with the phone, its SMS and the e-mail account** | Login codes | Recover the wallet onto their own device | Recovery needs the bank password, a **selfie** compared with the onboarding photo by a KYC operator, then a **72-hour time-lock** with alerts; the real client blocks it in one tap ("That wasn't me") and recoveries freeze. Even after all that, a recovery needs one of the client's parts | A perfect impostor whom the client never notices for 72 h, who also has the passkey, backup file or card |
| 3 | **Phisher with the bank password** | Login | Pay or recover | Login doesn't unlock any key part; payments need the device's passkey; recovery as in #2. Wrong passwords lock the login | — |
| 4 | **Scam dApp or scam recipient** | The client's attention | Get a payment or an unlimited approval signed | Screening of every recipient (sanctions/scam lists), unknown contracts refused, approvals only to approved dApps and never unlimited, dry run and plain-language effects before Face ID | Scams that use a legitimate-looking new address |
| 5 | **Malicious Swissquote insider / vault breach** | Part B, encrypted A backup, encrypted C | Sign alone | One part can't sign (tested); encrypted A needs the client's passkey, encrypted C the client's card | Refusal of service: the client signs with A + C |
| 6 | **Swissquote + notary collude** | B twice, encrypted C | Sign | The notary holds a copy of B, not a third part | — |
| 7 | **Malicious bank backend** | Approval tickets | Make the vault sign a different transaction | The device compares Swissquote's hash with the one Trust Wallet Core computed and aborts on a mismatch; the passkey signature binds the exact payment | — |
| 8 | **Replay** | An old ticket or authorization | Repeat a payment | Tickets are single-use and expire in 2 minutes; gasless authorizations carry a random nonce the token contract rejects twice | — |
| 9 | **Gasless abuse** | A client account | Drain Swissquote's fee account | 10 sponsored transfers per client per day, screening first, only the exact approved authorization is relayed, simulated before it is sent, valid for at most an hour | — |
| 10 | **Finder of the paper card** | Part C | Pay | One part; needs the client's device or Swissquote's approval | See #12 |
| 12 | **Thief with the phone *and* the card** | A (encrypted) + C | Sign without Swissquote | Part A on the phone still opens only with Face ID or the wallet password | Key refresh and device removal only cut parts off from **Swissquote**: an old A plus an old C still form the same key. A thief who has the card **and** can open the phone could sign alone. Remedy: move the funds to a new wallet (`npm run recover-offline -- … --to`); production: an in-app "move to a new wallet" |
| 11 | **Swissquote gone for good** | — | — | Notary releases its copy of B; the open-source tool moves the funds with any two parts | Time to reach the notary |

## Lock-out risks

| Situation | Outcome |
|---|---|
| Phone lost, laptop still there | Remove the phone from the laptop; nothing else changes |
| Every device lost | Recovery with the synced passkey (iCloud Keychain / Google Password Manager), the backup file + wallet password, or the paper card |
| Every device **and** the card **and** the backup lost | Only Part B is left: the funds are lost. The terms of use must say so; the onboarding asks the client to keep the card and offers the backup file |
| Swissquote refuses to co-sign | A + C on the device ("Continue without Swissquote") |
| Swissquote offline for good | Notary + emergency tool |

## What the tests prove

`npm test` (15 API tests) and `npm run test:browser` (2 browser scenarios with a virtual Face ID) run against the real MPC library, Trust Wallet Core and Sepolia:

- one part, or the same part twice, can't sign; forged and replayed vault tickets are refused;
- a sanctioned recipient is refused before signing, also when hidden inside a token transfer; an ETH transfer can't carry hidden call data;
- high-value payments need the SMS code; gasless relays only the exact approved authorization;
- dApps: unknown contracts and unlimited approvals are refused, a limited approval to an approved dApp is co-signed;
- an attacker with the password and the phone's codes is stopped by the identity check, and one who passes it is stopped when the client cancels during the time-lock;
- recovery with the paper card renews all parts with the same address; old parts no longer work with Swissquote's vault;
- the emergency tool signs without Swissquote from card + escrow and card + backup file.
