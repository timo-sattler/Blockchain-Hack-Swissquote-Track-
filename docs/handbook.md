# Handbook: the Swissquote Wallet explained without crypto knowledge

This document assumes you know nothing about crypto. It explains every idea the project uses, then walks through everything the wallet does, step by step, with the real numbers from the prototype. The other documents in this folder are the technical versions; this one is the plain-language companion.

---

## 1. The project in three sentences

Swissquote clients who want to hold their crypto **themselves** currently have to move it to another company's app and leave Swissquote. We built a wallet inside the Swissquote app where the client really owns their crypto, and Swissquote cannot take it, freeze it or move it. Unlike most self-custody wallets, losing your phone is not a disaster: you can get your wallet back, and a thief who steals your phone and e-mail cannot.

---

## 2. The basics you need

### Blockchain
A public record book of who owns what. Thousands of computers keep identical copies and agree on every new entry. Nobody can secretly edit it, and anyone can read it. Bitcoin has its own record book; Ethereum and its relatives have theirs.

### Address
Like an account number. Anyone can send money to it, and anyone can look up its balance. Our wallet has two: a Bitcoin address (starts with `tb1…` on the test network) and an Ethereum-style address (starts with `0x…`).

### Private key
The secret that proves you own an address. Whoever has the private key can move the money: there is no bank to call, no "forgot password". In practice the private key **is** the money. Everything in this project is about protecting it.

### Signature
To move money, you "sign" a payment with the private key: a mathematical stamp that proves the owner approved exactly this payment (this amount, to this recipient). Anyone can check the stamp; nobody can forge it without the key. If one digit of the payment changes, the stamp becomes invalid.

### Transaction and network fee
A transaction is a signed payment sent to the blockchain. The computers that record it charge a small **network fee** (called *gas* on Ethereum), paid in the network's own coin: BTC on Bitcoin, ETH on Ethereum-style networks. That is why the wallet needs a little ETH even to send USDC.

### Bitcoin, Ethereum, EVM, Base
- **Bitcoin (BTC):** the original cryptocurrency.
- **Ethereum (ETH):** a second network that also runs small programs.
- **EVM chains:** networks that work like Ethereum and use the same kind of address. **Base** is one of them; we use it.
- Our wallet works on Bitcoin **and** EVM chains with the same key.

### USDC
A "stablecoin": a token on the blockchain worth 1 US dollar, issued by the company Circle. It lets people move dollars on a blockchain.

### Testnet
A practice copy of a blockchain where the coins are free and worthless. The prototype uses **Bitcoin testnet4** and **Base Sepolia**, so no real money is ever at risk. Free test coins come from websites called *faucets*.

### Custody vs. self-custody
- **Custody:** a company holds the private key for you (like a bank holding your cash). Convenient, but you trust the company, and in Switzerland it comes with strict banking rules.
- **Self-custody:** you hold the key yourself. Nobody can take or freeze your money, but traditionally, if you lose the key, the money is gone.

### Seed phrase
The traditional self-custody backup: 12 or 24 English words that recreate the key. Write them down, never lose them, never let anyone see them. Most people fail at one of the three, which is why we do not use one.

### Passkey
The modern replacement for passwords, built into iPhones, Android phones, Macs and Windows PCs. When you "sign in with Face ID", the phone uses a secret stored in its security chip. The secret never leaves the device, only works on the website it was created for (so fake websites cannot use it), and is unlocked with your face or fingerprint.

---

## 3. The idea: one key, three pieces, any two are enough

Imagine a safe with an unusual lock: there are **three different keys**, and **any two** of them open it. One key alone does nothing.

- Key **A** is on Anna's **phone**.
- Key **B** is at **Swissquote**.
- Key **C** is in Anna's **recovery kit**, a file she keeps in her cloud drive or on a USB stick, locked with a password only she knows.

In the real system these "keys" are **shares** of one single private key, and the technique is called **MPC** (multi-party computation) or **threshold signatures**. Two share holders can produce a valid signature together by exchanging a few messages, **without ever putting the full private key together**, not even for a split second. The full key does not exist anywhere. We use an established library for this (Silent Shard by Silence Laboratories, protocol "DKLs23"); we did not invent any cryptography.

What this gives Anna:

| Who comes together | What they can do | When it happens |
|---|---|---|
| Phone (A) + Swissquote (B) | Sign a payment | Every normal payment. Swissquote first checks the payment |
| Phone (A) + Kit (C) | Sign a payment | Swissquote is down, refuses, or no longer exists |
| Kit (C) + Swissquote (B) | Create a **new** phone share | Anna lost her phone (recovery) |
| Any single share | **Nothing** | |

So: Swissquote alone can do nothing; a thief with only the phone can do nothing; a thief with only the kit can do nothing.

---

## 4. A day in the life of the wallet

### 4.1 Creating the wallet (about 10 seconds)

1. Anna opens the Swissquote app → **Crypto** tab → types her name → **Create my wallet**.
2. Her phone asks for **Face ID** and creates a **passkey** for the wallet. Swissquote stores the passkey's *public* part so it can recognise her later.
3. Her phone and Swissquote's server run the key creation together. The phone plays two roles (A and C), Swissquote plays B. Out come three shares and one public key, from which the two addresses (Bitcoin and Base) are calculated.
4. Share A stays on the phone. Share B stays at Swissquote. Share C is shown to Anna as the **recovery kit**: she picks a password (at least 8 characters), and the app encrypts Share C with it and downloads the file (about 250 KB). The phone does **not** keep Share C.
5. Demo extra: a Swissquote "treasury" account sends a welcome bonus of **20 test USDC + 0.0005 test ETH** so Anna can try a payment (if the treasury has test coins).

Because Swissquote took part in creating the key, it knows from the first second that these addresses belong to Anna. That matters for the law (see section 7).

### 4.2 Paying someone (phone + Swissquote)

1. Anna taps **Send**, picks USDC, ETH or BTC, enters the amount and the recipient's address.
2. **Face ID** confirms it's her; Swissquote checks the passkey (the login is valid for 5 minutes).
3. Swissquote reads the payment itself: who receives it, how much, on which network. It refuses if the recipient is on a **sanctions list** (a list of addresses linked to criminals or sanctioned countries; mocked with one test address). Above **1 000 USDC** it asks Anna for an extra confirmation.
4. Swissquote calculates the payment's fingerprint (a "hash"); Anna's phone calculates it too. If they don't match, the phone stops. Neither side can trick the other.
5. Phone and Swissquote sign together; the phone sends the signed payment to the blockchain and shows a link to see it on a public explorer.

### 4.3 Paying when Swissquote is down (phone + kit)

If Swissquote does not answer, the app says *"Swissquote can't co-sign right now. You don't need it."* Anna opens her kit file, types the password, and phone + kit sign on her device. No Swissquote computer is involved. (In the demo we stop Swissquote's server live and still send a payment.)

### 4.4 Losing the phone: recovery

1. On a new phone, Anna opens the app → **Lost your phone and passkey? Recover with your kit** → opens the kit file and types the password.
2. **Identity check:** ID document + live selfie compared with her Swissquote profile (mocked in the demo with two buttons: *Take selfie as Anna* or *Attacker…*).
3. **Waiting period: 48 hours** (30 seconds in the demo). Swissquote alerts Anna on every channel. Any device that still has the wallet shows a red warning.
4. After the wait, the new phone creates a new passkey. Kit and Swissquote then issue **new shares for everyone** (new A for the phone, new B for Swissquote, new C for a new kit). The **addresses stay the same**, so nothing moves and nobody needs new payment details.
5. Anna saves the new kit with a password and deletes the old kit file.

### 4.5 Someone else tries to recover Anna's wallet

**Case 1: a thief has Anna's phone and her e-mail.** They cannot even start: they have no kit file, no kit password, and their face doesn't match. The demo shows the refusal: *"Identity check failed: the selfie does not match the client on file."* E-mail and SMS codes are never enough.

**Case 2: somehow a recovery is started without Anna.** Her phone shows: *"Someone is recovering this wallet on a new phone… If this is not you, stop it now."* She taps **This is not me · Cancel recovery**, confirms with Face ID, and it's over. The other phone sees *"Recovery cancelled"*.

### 4.6 Extra safety nets

- **Pieces for friends.** Right after saving her kit, Anna can create 3 "piece" files and send one to each of 3 people she trusts. Any 2 pieces give back her kit, **still locked with her kit password**. So her friends hold the data and Anna holds the secret: one piece alone is useless, and even two friends together cannot open it without her password. Technique: the password-locked kit is locked once more with a random key, and only that key is split with *Shamir's secret sharing* (a published, audited method).
- **Backup with friends on the blockchain.** Instead of piece files, Anna can send each piece straight to a friend's Swissquote wallet. First each friend taps **Hold backups for friends**: their wallet publishes a "mailbox key" on the blockchain, signed by the friend themselves, so nobody (not even Swissquote) can slip in a fake mailbox. Anna's app then puts her kit on the blockchain, still locked with her password, and one sealed piece for each friend. If she ever loses phone and kit, her new phone shows a link and a 6-digit safety code. She sends the link to her friends and reads them the code on the phone. Each friend taps **Give back**, and the piece travels over the blockchain to her new phone only. Two pieces plus her password rebuild the kit. Swissquote pays the network fees. Details: [`onchain-backup.md`](onchain-backup.md).
- **Replace a lost kit.** If the kit file is lost or stolen, the **Replace** button makes new pieces of the key for everyone (phone, Swissquote, kit). The old kit and old friend pieces stop working.
- **Escrow agent.** Swissquote gives a copy of its piece to an independent agent. The agent only acts if Swissquote has disappeared, only for the real Anna (identity check), and only together with her kit. Afterwards it deletes the copy.
- **Free USDC transfers.** When Anna sends USDC with Swissquote, she signs a "permission slip" instead of a transaction, and Swissquote submits it and pays the network fee. She needs no ETH at all. Swissquote limits how many free transfers each wallet gets per day.

### 4.7 The old phone after a recovery

Swissquote counts "generations" of shares. Every recovery starts a new generation. The old phone holds a share from the old generation, so:
- it shows *"This phone no longer controls the wallet"* and its Send button is disabled;
- if it tries anyway, Swissquote refuses: *"This phone was replaced…"*.

One honest limit: the old phone's share and the **old** kit file still fit together (two shares of the old generation). That's why the app tells Anna to delete the old kit.

---

## 5. Who can do what

| Person | Can they move Anna's money? | Can they block Anna? |
|---|---|---|
| **Anna** | Yes: phone + Face ID (with Swissquote), or phone + kit (without) | n/a |
| **Swissquote** | **No.** One share only. It cannot recover the wallet without Anna's kit either | It can refuse to co-sign, but Anna then uses phone + kit. If Anna lost her phone, she needs Swissquote for recovery |
| **Thief with the phone** | No: needs Face ID for Swissquote, or the kit + password | No |
| **Thief with phone + e-mail + SIM** | No (refused at recovery) | No |
| **Thief with the kit file** | No: needs the password, and the kit is still only one share | No |
| **Thief with phone + kit + password** | **Yes** (two shares). Keep the kit away from the phone | Yes |
| **A friend** | Not involved today | No |

---

## 6. What happens if…

| If… | Then… |
|---|---|
| …Anna loses her phone | Recovery with kit + identity check + 48 h |
| …Anna loses her kit but has her phone | She taps **Replace** next to the kit: Face ID, then her phone and Swissquote make new shares and a new kit. Whoever finds the old kit can do nothing with it |
| …Anna loses phone **and** kit | If she split her kit among 3 trusted people, any 2 of them send her their piece files; with her kit password the app rebuilds the kit, then the normal recovery runs. Without pieces, or if she forgot the password, the money is lost |
| …Swissquote's server is down | Anna pays with phone + kit |
| …Swissquote stops existing | Phone + kit keep working. If she has also lost her phone, an independent **escrow agent** (think: a notary) that holds a copy of Swissquote's piece helps her once, after checking her identity, and then deletes its copy |
| …Anna is tricked into paying a scammer | The payment is valid; sanctions screening and the large-amount confirmation catch some cases, not all |
| …Anna types a sanctioned address | Swissquote refuses to co-sign |
| …Anna forgets the kit password | The kit is useless; with her phone she can still pay; she should create a new kit |

---

## 7. The law, in plain words

**Is Swissquote holding Anna's money (custody)?** No. The test is "who can move the money". Swissquote has one of three shares and needs Anna's phone or Anna's kit to sign anything. It can only *stop* payments (for example to sanctioned addresses), never *make* them. So it is software plus a co-signing service, not custody. The money is not on Swissquote's balance sheet; if Swissquote went bankrupt, Anna would keep paying with phone + kit.

**The Travel Rule.** Swiss rules say a bank may only send crypto to, or receive it from, a private wallet after checking that its own client owns that wallet. Usually that's slow manual work (signed messages, test transfers). Here it is automatic: Swissquote helped create the key in Anna's logged-in session and holds one share, so it knows the wallet is hers.

**When Anna pays a stranger, is Swissquote the sending bank?** Mostly not: Anna starts and approves the payment, and she could send it without Swissquote (phone + kit). But Swissquote co-signs and screens normal payments, so a regulator could see it as helping. That's the main question for a lawyer. Details: [`legal-compliance.md`](legal-compliance.md).

---

## 8. Why Swissquote would build it, in plain words

Clients who leave for an external wallet take their coins and their future trading with them. With this wallet the coins stay one tap away from the Swissquote trading account, so selling or swapping happens at Swissquote. Swissquote can charge for premium recovery or inheritance services, saves the manual wallet checks, and carries no custody burden for coins clients hold themselves. Numbers and assumptions: [`business-case.md`](business-case.md).

---

## 9. What is real and what is pretend in the demo

| Part | Real or pretend? |
|---|---|
| The three shares and the signing between phone and Swissquote | **Real** cryptography |
| Passkeys (Face ID / fingerprint) | **Real** |
| Payments on Bitcoin testnet4 and Base Sepolia | **Real** test-network transactions (test coins, worthless) |
| The recovery kit file and its encryption | **Real** |
| Recovery waiting period, cancel button, lockout of the old phone | **Real** rules in Swissquote's (mock) server |
| Kit replacement and friend pieces | **Real** cryptography |
| Escrow agent | **Pretend** notary (a separate small program); the protocol it runs is real |
| Free (gasless) USDC transfers | **Real** signed permission + real relaying; needs test USDC in the wallet |
| Swissquote's server itself | **Pretend**: a small program on a laptop, standing in for Swissquote's real systems |
| ID + selfie check | **Pretend**: a button chooses "match" or "attacker" |
| Sanctions list | **Pretend** list with one test address (the checking rule is real) |
| Alerts by e-mail/SMS/push | **Pretend**: shown in the app and the presentation screen |
| Swissquote account balances and the other app tabs | **Pretend** demo data |

---

## 10. Numbers cheat sheet

| Setting | Demo | Real product |
|---|---|---|
| Shares / needed to sign | 3 / 2 | 3 / 2 |
| Recovery waiting period | 30 seconds | 48 hours |
| Extra confirmation above | 1 000 USDC | Set by compliance |
| Face ID login valid for | 5 minutes | Same or shorter |
| Kit password minimum | 8 characters | Stronger rules |
| Kit encryption | 310 000 rounds of password stretching + AES-256 | Same |
| Welcome bonus (test coins) | 20 USDC + 0.0005 ETH | Would be gas sponsoring, not a gift |
| Free USDC transfers per wallet per day | 10 | Set by Swissquote |
| Friend pieces | 3 pieces, any 2 + the kit password rebuild the kit | Same |
| Escrow agent steps in after Swissquote is unreachable for | 20 seconds | Liquidation confirmed |
| Networks | Bitcoin testnet4, Base Sepolia | Bitcoin, Base, other EVM chains |

---

## 11. Glossary A–Z

| Term | Meaning |
|---|---|
| **Address** | Public "account number" on a blockchain |
| **AES-256-GCM** | Standard encryption used to lock the kit file |
| **Base / Base Sepolia** | An Ethereum-style network / its test version |
| **Blockchain** | Public, shared record book of transactions |
| **Co-sign** | Two share holders signing together |
| **Custody** | Someone else holds your key |
| **DKLs23** | The published MPC method our library uses |
| **Epoch** | Our name for the "generation" of shares; goes up with every recovery |
| **Faucet** | Website giving away free test coins |
| **Gas / network fee** | Payment to the network for recording a transaction |
| **Hash** | A short fingerprint of a payment; changes completely if anything changes |
| **HSM** | Tamper-proof hardware banks use to store secrets |
| **KYC** | "Know your customer": identity checks banks must do |
| **MPC / threshold signature** | Splitting a key into shares so that some of them can sign together without rebuilding the key |
| **Passkey** | Face ID / fingerprint login secret stored in the device's security chip |
| **PBKDF2** | Password stretching: makes each password guess slow |
| **Private key** | The secret that controls an address |
| **PSBT** | The format of an unsigned Bitcoin payment |
| **Recovery kit** | Anna's encrypted file with Share C |
| **Sanctions screening** | Checking recipients against lists of blocked addresses |
| **Seed phrase** | 12/24 backup words of a traditional wallet (not used here) |
| **Self-custody** | You hold your own key |
| **Share** | One of the three pieces of the key |
| **Signature** | Mathematical proof that the owner approved a payment |
| **Stablecoin / USDC** | Token worth one US dollar |
| **Testnet** | Practice blockchain with worthless coins |
| **Travel Rule** | Rule that crypto transfers must carry sender/receiver information; in Switzerland, private wallets must be verified |
