# Handbook: the Swissquote Wallet without crypto knowledge

For anyone on the team who presents or answers questions. Technical details: [`architecture.md`](architecture.md).

## 1. The project in three sentences

Swissquote clients who want to hold their own crypto today move it to an outside wallet and leave. We built a wallet where the client holds the keys, but Swissquote checks every payment for scams, pays the fees for stablecoins, and helps the client get back in after losing their phone. Swissquote can never move the money on its own.

## 2. The basics

- **Blockchain:** a public ledger of who owns what. Ethereum is one; we use its free test version, **Sepolia**.
- **Address:** like an account number (`0x…`). Anyone can send to it.
- **Private key:** the secret that lets you spend from an address. Whoever has it, owns the money.
- **Signature:** proof, made with the key, that the owner approved a payment.
- **Network fee (gas):** every payment costs a small fee, paid in ETH.
- **ETH, USDC, EURC, WETH:** ETH is Ethereum's own coin. USDC (dollar) and EURC (euro) are stablecoins by Circle. WETH is ETH in token form, used by DeFi apps.
- **Custody vs. self-custody:** custody means the bank holds the key (like a bank account). Self-custody means you hold it.
- **Passkey:** a login built into the phone, unlocked with Face ID. Nothing to remember, nothing to phish.
- **dApp:** an app that runs on the blockchain, e.g. an exchange like Uniswap.

## 3. The idea: one key in three parts

The key is never in one place. It exists as three parts, and **any two** can sign:

| Part | Who has it | Think of it as |
|---|---|---|
| **A** | Your phone (and laptop), locked by Face ID | Your house key |
| **B** | Swissquote | The bank's key to the same safe |
| **C** | Locked by a paper card with 24 words, kept at home or with someone you trust | The spare key at a friend's |

Every normal payment uses **A + B**: your Face ID plus Swissquote's check. If Swissquote is offline, **A + C** still works. If you lose your phone, **B + C** (after an identity check) gets you a new phone with the same wallet. The parts never get put together: a technique called **MPC** lets two parts sign together without ever creating the full key.

## 4. A day in the life

1. **Creating the wallet (1 minute).** Log in with your Swissquote client ID, password and SMS code. Take a reference photo. Confirm with Face ID. Write down the 24 words of your Recovery Card.
2. **Paying someone.** Enter the address and amount. Swissquote checks the recipient against sanctions and scam lists. Approve with Face ID. Above CHF 1,000 you also type an SMS code.
3. **Sending USDC for free.** Tick "Swissquote pays the network fee": you need no ETH at all.
4. **Using a DeFi app.** In Apps, wrap ETH into WETH. Swissquote tests the request first and shows what will happen: "0.01 ETH leaves your wallet, 0.01 WETH arrives". A scam request ("give this app unlimited access to your USDC") is refused with an explanation, before anything is signed.
5. **Adding the phone.** On the laptop, "Add a device" shows a QR code. Scan it with the phone, log in, Face ID. Same wallet on both.
6. **Losing the phone.** On the laptop or in eBanking: "Report lost". Swissquote stops accepting the phone, so it can't approve payments any more.
7. **Losing everything.** Log in, take a selfie; a Swissquote specialist compares it with your reference photo. After a waiting period (72 hours; you get alerts and can block it) you give one part you still have, and you get a new card. Same address, same money.
8. **Swissquote is gone.** An independent notary hands out Swissquote's part; a free tool moves your money with any two parts.

## 5. Who can do what

| Who | Can they move your money? |
|---|---|
| You (phone + Face ID) | Yes, with Swissquote's check |
| You (phone + paper card) | Yes, without Swissquote |
| Swissquote alone | **No** (one part) |
| Swissquote + the notary | **No** (the notary has a copy of the same part) |
| A thief with your phone | No (needs your Face ID) |
| A thief with your phone and e-mail | No: recovery also needs your face, a waiting period you can stop, and one of your parts |
| Someone who finds your card | No (one part) |

## 6. The law, in plain words

- Swissquote can't move the money alone, so it is **not custody**: no bank-style capital rules for these assets.
- Swiss banks must prove a wallet belongs to their client before sending crypto to it (Travel Rule). Our wallet proves it automatically when it is created.
- When you pay a stranger, you sign with your own key, so Swissquote isn't the sending bank; it still checks the recipient.

## 7. Why Swissquote would build it

Clients stay instead of leaving with their coins; Swissquote earns a recovery subscription (CHF 4.90 a month or CHF 99 per recovery), keeps trading revenue, saves manual compliance work and carries no custody risk. Details: [`business-case.md`](business-case.md).

## 8. Real or pretend in the demo

| Real | Pretend (mock) |
|---|---|
| The three-part key and MPC signing | Swissquote's bank backend and login |
| Face ID (passkeys) | SMS codes (shown on screen) |
| Transactions on the Sepolia test network | The identity check (you play the specialist) |
| Free USDC/EURC transfers | The sanctions list (a few sample addresses) |
| dApp checks with a dry run on Sepolia | The notary (a file) |

## 9. Numbers cheat sheet

| What | Value |
|---|---|
| Key parts / needed to sign | 3 / 2 |
| SMS code needed from | CHF 1,000 (CHF 20 in the demo) |
| Daily limit | CHF 5,000 |
| Free stablecoin transfers | 10 per day |
| Recovery waiting period | 72 hours (15 s with `npm run demo:fast`) |
| Signing ticket validity | 2 minutes, single use |
| "Add a device" QR code | 10 minutes, single use |
| Tests | 15 API + 2 browser |
