# Why the wallet is secure

The security rests on one principle: **there is no single point where an attacker gets everything.** Each layer protects on its own, and an attacker would have to break several of them at the same time.

Throughout this document, **Anna** is our example Swissquote client.

## Layer 1: The key never leaves the phone

The passkey's private key is created inside the phone's **secure chip** (Secure Enclave on iPhone, Titan/StrongBox on Android). Apple and Google built this chip for exactly this purpose: it never hands out the key, not to apps, not to the operating system, not to us. It can only be asked to "sign this", and it does so only after Face ID or a fingerprint.

**Result:** Even malware on the phone cannot copy the key. A seed phrase written on paper, by contrast, can be photographed.

## Layer 2: Passkeys are immune to phishing

A passkey is bound to the **domain** it was created on, e.g. `wallet.swissquote.ch`. A scam site such as `swissquote-wallet-support.com` cannot even request it; the browser blocks it.

**Result:** The most common way crypto gets stolen ("enter your 24 words here") is technically impossible. There is nothing to type in.

## Layer 3: The blockchain verifies every signature mathematically

Every transfer is signed, and the signature covers the **exact content**: amount, recipient, nonce. The smart account on the blockchain checks it before doing anything.

- Without Anna's key, nobody can forge a valid signature. This rests on the same mathematics that protects online banking and HTTPS.
- If anyone changes even a single digit on the way, for example the recipient, the signature becomes invalid and the contract rejects it.

**Result:** The bundler, the paymaster, Swissquote and we as developers **cannot move funds**. A bundler can at most refuse a transaction, and then another bundler is used.

## Layer 4: The rules are public and cannot be changed in secret

Who the owner is and who the guardians are is stored in the contract on the blockchain. Anyone can verify it, and nobody can change it secretly: any change itself requires a valid signature according to the contract's rules.

**Result:** "Swissquote cannot access your funds" is **verifiable**, not a promise in the terms and conditions.

## Layer 5: Recovery needs two independent factors plus time

Recovery requires 2 of 3 guardians, followed by a 48-hour waiting period, a warning to all of Anna's devices, and the option for Anna to cancel. An attacker would need two completely different things at the same time, for example Anna's USB security key **and** Anna's face for the ID check, and then Anna would still have to miss the warning for 48 hours.

## Layer 6: Limits cap the damage

High-value transfers require Swissquote's compliance check or a 48-hour delay. If an attacker succeeds despite everything, they can only reach small amounts.

## Walking through the attacks

| Attack | What the attacker has | Why it fails |
|---|---|---|
| Stolen phone | The device | No Face ID. Even if unlocked: limits apply, and Anna replaces the key through recovery. |
| Malware on the phone | Control over apps | Cannot reach the key in the secure chip. Every signature needs Anna's Face ID. |
| Phishing website | Anna's trust | The passkey does not work on the wrong domain, and there are no words to ask for. |
| Hijacked email or SIM card | Anna's inbox or phone number | Email and SMS play no role in the system at all. |
| Hacked Swissquote server | Swissquote's guardian vote | Only 1 of 3 votes. Cannot sign any transfer. |
| Malicious bundler or paymaster | Anna's transaction in transit | Cannot change it, only refuse it. |
| Someone reads the public key from the browser | Public data | It can only be used to verify signatures, not to create them. |

## Where the security ends

We state the limits openly:

- **Anna is talked into it:** she herself confirms a transfer to a scammer. Only warnings, transaction simulation and the high-value limit help here.
- **Anna's Apple or Google account is hacked**, if the passkey is synced through it.
- **A bug in the smart contract.** That is why we use audited building blocks and write as little custom contract code as possible.
- **Prototype status:** layers 1–4 are built today. Recovery (layer 5) and limits (layer 6) are next.

## In one sentence (for the pitch)

> To steal Anna's money you need her phone **and** her face. To recover her wallet you need two independent factors **and** 48 hours in which Anna notices nothing. And Swissquote can do none of this alone.
