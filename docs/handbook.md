# Handbook: the Swissquote Wallet explained without crypto knowledge

This document assumes you know nothing about crypto. It explains every idea the project uses, then walks through everything the wallet does, with the real numbers from the prototype. The other documents in this folder are the technical versions.

---

## 1. The project in three sentences

Swissquote clients who want to hold their crypto **themselves** currently have to move it to another company's app and leave Swissquote. We built a wallet inside the Swissquote app where the client really owns their crypto and Swissquote cannot take it or move it. Going through Swissquote also makes it safer and cheaper: Swissquote blocks payments to known scammers and pays the fees for stablecoin transfers.

---

## 2. The basics you need

### Blockchain
A public record book of who owns what. Thousands of computers keep identical copies and agree on every new entry. Nobody can secretly edit it, and anyone can read it. Bitcoin has its own record book; Ethereum and its relatives have theirs.

### Address
Like an account number. Anyone can send money to it and look up its balance. Our wallet has a Bitcoin address (starts with `tb1…` on the test network) and an Ethereum-style address (starts with `0x…`).

### Private key
The secret that proves you own an address. Whoever has the private key can move the money: there is no bank to call, no "forgot password". In practice the private key **is** the money.

### Signature
To move money, you "sign" a payment with the key: a mathematical stamp that proves the owner approved exactly this payment (this amount, to this recipient). Anyone can check the stamp; nobody can forge it. If one digit of the payment changes, the stamp becomes invalid.

### Transaction and network fee
A transaction is a signed payment sent to the blockchain. The computers that record it charge a small **network fee** (called *gas* on Ethereum), normally paid in the network's own coin. In our wallet, Swissquote pays this fee for USDC and EURC transfers.

### Bitcoin, Ethereum, EVM, Base
- **Bitcoin (BTC):** the original cryptocurrency.
- **Ethereum (ETH):** a second network that also runs small programs.
- **EVM networks:** networks that work like Ethereum and use the same kind of address. **Base** is one of them; we use it.
- Our wallet works on Bitcoin **and** EVM networks with the same key.

### Stablecoins: USDC and EURC
Tokens on the blockchain worth 1 US dollar (USDC) or 1 euro (EURC), issued by the company Circle. They let people move dollars and euros on a blockchain.

### Testnet
A practice copy of a blockchain where the coins are free and worthless. The prototype uses **Bitcoin testnet4** and **Base Sepolia**, so no real money is ever at risk. Free test coins come from websites called *faucets*.

### Custody vs. self-custody
- **Custody:** a company holds the key for you (like a bank holding your cash). In Switzerland it comes with strict banking rules.
- **Self-custody:** you hold the key yourself. Nobody can take your money, but traditionally, if you lose the key, the money is gone.

### Passkey
The modern replacement for passwords, built into iPhones, Android phones, Macs and Windows PCs. When you "sign in with Face ID", the device uses a secret stored in its security chip. The secret only works on the website it was created for (so fake websites cannot use it) and is unlocked with your face or fingerprint.

---

## 3. The idea: one key in two parts

Imagine a safe with a lock that needs **two different keys turned together**. One key alone does nothing.

- Key **A** belongs to Anna. It is on her **laptop**, and she can put an **identical copy** on her **phone**. Each device unlocks its copy with its own Face ID.
- Key **B** is at **Swissquote**.

To pay, both keys turn together. Before turning its key, Swissquote looks at the payment: if the recipient is a known scammer or on a sanctions list, it refuses. Because Anna only ever has key A (copies of it), there is no way to pay without this check.

**The real trick:** in our wallet, the two keys are not two copies of a password. They are two halves of one secret, made with a technique called **threshold signatures (MPC)**. The two halves compute a signature together by exchanging messages, without ever being put together. The whole secret key **never exists anywhere**, not on Anna's laptop, not at Swissquote, not for a second.

**And if Swissquote disappears?** An independent notary (the **escrow agent**) keeps a copy of Swissquote's key. If Swissquote is unreachable for six months (the **grace period**), the notary hands that copy to Anna's device, and from then on she can pay alone. Swissquote and the notary have the same key B, so even together they can never pay without Anna.

---

## 4. A day in the life of the wallet

### 4.1 Creating the wallet (about 10 seconds)
Anna opens the Crypto tab, types her name and taps *Create my wallet*. Face ID registers a passkey with Swissquote. Then her laptop and Swissquote run the key creation together: four rounds of messages, and each ends up with its half. Her addresses appear: one for Bitcoin, one for Ethereum-style networks.

### 4.2 Paying someone
Anna taps *Send*, picks USDC, enters 5 and the recipient, and confirms with Face ID. Swissquote checks the recipient, then the two halves sign together. The fee row says *Free · paid by Swissquote*: for USDC and EURC, Swissquote pays the network fee, so Anna needs no ETH at all.

### 4.3 Swissquote stops a scam
Anna pastes an address from a "you won an airdrop" message. Swissquote finds it on its list of scam addresses and refuses: the app shows **Blocked by Swissquote**. Nothing was signed, no money moved.

### 4.4 Adding her phone
On the laptop, Anna taps *Add a device* and Face ID. A QR code appears. She scans it with her phone, which creates its own Face ID passkey and receives an identical copy of her key A, encrypted with a one-time secret that is only inside the QR code. Swissquote passes the copy along but cannot read it. Now both devices can pay.

### 4.5 Losing the laptop
The laptop is stolen. On her phone, Anna taps *Remove* next to it. Swissquote stops accepting the laptop's Face ID, so the copy of key A on it is useless. On her new laptop she does *Add a device* from the phone, and everything is back, with the same addresses.

### 4.6 Swissquote is gone
If Swissquote stops working, Anna's wallet shows *Swissquote is unreachable: your wallet is paused*, because every payment needs key B. After the grace period (six months in reality, 30 seconds in the demo), she taps *Take over my wallet*. Her phone proves it holds key A, the notary hands over its copy of key B and deletes it, and the phone now pays alone.

---

## 5. Who can do what

| Who | Holds | Can pay alone? | Can stop a payment? |
|---|---|---|---|
| Anna (any of her devices) | Key A + Face ID | No: needs Swissquote | — |
| Swissquote | Key B | **No** | Yes: scams, sanctions, limits |
| Escrow agent (notary) | Copy of key B | **No**, not even with Swissquote | No |
| A thief with Anna's locked phone | The device | No | — |
| Anna after the grace period | Key A + key B | Yes | — |

---

## 6. What happens if…

| …this happens | What it means |
|---|---|
| …Anna loses one device | Nothing lost: she removes it and keeps using the other one |
| …Anna loses every device | The money is lost. That is why the app suggests a second device right after creation |
| …someone steals her phone and knows nothing else | They cannot unlock Face ID; Anna removes the phone |
| …Swissquote is hacked | The hacker has key B, which cannot sign alone |
| …Swissquote is down for a day | Payments wait; nothing is lost |
| …Swissquote stops existing | After six months, the notary hands Anna key B |
| …Anna wants to pay a scammer | Swissquote refuses |

---

## 7. The law, in plain words

- **Is this custody?** No: Swissquote cannot move the money on its own, and the money never sits on Swissquote's books. Swissquote can only *stop* payments, which is what the screening is for.
- **The Travel Rule.** Swiss rules require banks to know who owns an outside wallet before sending crypto to it. Here Swissquote helped create the wallet inside the client's account, so it knows from the first second. Because Swissquote checks every payment, it acts as the sending bank for payments to third parties.
- **If Swissquote goes bankrupt**, the money is not part of the bankruptcy: it is at Anna's own addresses. After the grace period she gets sole control.

---

## 8. Why Swissquote would build it

Today a client who wants self-custody withdraws to another app and is gone. With this wallet, the client keeps their coins *and* stays: buying, selling and moving back are one tap away in the Swissquote app. Swissquote saves the manual ownership checks, carries no custody burden, and offers something no Swiss bank offers today. Details: [`business-case.md`](business-case.md).

---

## 9. What is real and what is pretend in the demo

| Part | Real or pretend |
|---|---|
| The two-part key, Face ID passkeys, signing | **Real** cryptography |
| Payments on the test networks, free USDC/EURC | **Real** (test coins) |
| Adding and removing devices, grace period and takeover | **Real** |
| The list of scam addresses | **Pretend** (three made-up addresses) |
| Swissquote's backend and the notary | **Pretend** (small programs on a laptop, each with its own storage) |
| The rest of the Swissquote app (Home, Trade, Bank, Plan) | **Pretend** (static pictures of demo data) |

---

## 10. Numbers cheat sheet

| Thing | Number |
|---|---|
| Parts of the key | 2 (identical copies of Anna's part on each of her devices) |
| Size of one part | about 121 KB |
| Message rounds to create the key | 4 |
| Message rounds to sign | 4 |
| Add-a-device link | works once, for 10 minutes |
| Extra confirmation above | 1,000 USDC or EURC |
| Free stablecoin transfers | 10 per wallet per day |
| Grace period | six months (demo: 30 seconds) |

---

## 11. Glossary A–Z

| Term | Meaning |
|---|---|
| **Address** | Public account number on a blockchain |
| **EIP-3009** | A way to sign "move my USDC/EURC" without paying gas yourself; someone else submits it |
| **Escrow agent** | Independent notary that keeps a copy of Swissquote's key part for the grace period |
| **Gas** | The network fee on Ethereum-style networks |
| **Grace period** | Six months during which the wallet waits if Swissquote is unreachable, before the notary hands over its copy |
| **MPC / threshold signature** | Computing one signature from key parts held by different parties, without ever joining the parts |
| **Part (key part)** | One half of the wallet's secret; useless alone |
| **Passkey** | Face ID / fingerprint login bound to one website |
| **Screening** | Checking a recipient against lists of scam and sanctioned addresses |
| **Testnet** | Practice blockchain with worthless coins |
