# Why the wallet is secure

The security rests on one principle: **there is no single place where an attacker gets everything.** The key is split into three shares, two are needed, and each share is protected differently. Throughout this document, **Anna** is our example Swissquote client. Terms: [`handbook.md`](handbook.md). Attacker-by-attacker detail: [`threat-model.md`](threat-model.md).

## Layer 1: The key never exists in one piece

Anna's key is created directly as three shares: one on her phone (A), one at Swissquote (B), one in her recovery kit (C). The full key is never assembled, not when the wallet is created, not when she pays, not during a recovery. Signing is a short conversation between two share holders that produces a normal signature without either side learning the other's share.

**Result:** stealing one share, from any one place, is worthless.

## Layer 2: Each share is guarded by something different

| Share | Guarded by |
|---|---|
| A (phone) | Phone lock; every use with Swissquote needs Anna's passkey (Face ID). Prototype: stored in browser storage; production: encrypted with a passkey-derived key |
| B (Swissquote) | Swissquote's servers (production: HSM, dual control); only used after a valid passkey login from Anna |
| C (kit) | A password only Anna knows; 310 000 rounds of key stretching make every guess slow |

**Result:** an attacker needs two different kinds of access at once, for example Anna's phone **and** her kit file **and** its password.

## Layer 3: Passkeys cannot be phished

Anna confirms with Face ID instead of a password or seed words. A passkey only works on the website it was created for: a fake site cannot ask for it, and there are no words she could be tricked into typing.

## Layer 4: Swissquote checks what it signs, and Anna checks Swissquote

Before co-signing, Swissquote decodes the payment itself (amount, recipient, chain), screens the recipient against a sanctions list and asks for an extra confirmation above 1 000 USDC. It then signs **its own** fingerprint (hash) of the payment. Anna's phone computes the same fingerprint and aborts if they differ.

**Result:** a compromised phone cannot make Swissquote sign something else, and a compromised Swissquote cannot make the phone sign something else.

## Layer 5: Recovery needs Anna's kit, her face and time, and she can say no

To move the wallet to a new phone, someone needs the kit **and** its password, must pass an ID + selfie check, and must wait 48 hours. During that time every device that still holds the wallet shows a red warning with a **Cancel** button that works with Anna's passkey. E-mail and SMS play no role at all.

## Layer 6: A replaced phone is cut off

Every recovery re-issues all three shares. Swissquote remembers which generation is current and refuses to co-sign with an older one. The old phone tells its holder it no longer controls the wallet.

## Layer 7: Swissquote cannot lock Anna's spending

If Swissquote refuses or disappears, Anna signs with phone + kit, two shares, entirely on her device.

## Walking through the attacks

| Attack | What the attacker has | Why it fails |
|---|---|---|
| Stolen, locked phone | The device | No Face ID, no Swissquote co-signature, no kit |
| Stolen phone + hacked e-mail + SIM swap | Share A, inbox, phone number | Recovery needs the kit, its password and Anna's face; e-mail and SMS are never accepted. Shown live in the demo |
| Stolen kit file | Encrypted Share C | Password unknown; even with it, one share cannot sign, and a recovery triggers alerts and a 48 h veto window |
| Hacked Swissquote server | Share B | One share cannot sign, and recovery needs Anna's kit |
| Tampered Swissquote service | Control of co-signing | The phone compares fingerprints and aborts |
| Phishing website | Anna's trust | The passkey does not work on the wrong site; nothing to type |
| Payment to a sanctioned address | Anna's confirmation | Swissquote refuses to co-sign |
| Thief keeps using the old phone after Anna recovers | Old Share A | Swissquote refuses the outdated share |

## Where the security ends

- **Phone + kit + kit password together** give full control without Swissquote: that is the definition of 2 of 3. The kit must never be stored on the phone, and the password never next to the kit.
- **Old phone + old kit** still work together offline after a recovery: Anna must delete the old kit (the app tells her); after a theft she can sweep to a new key.
- **Anna is talked into a payment.** Screening and the high-value confirmation help, but cannot stop every scam.
- **Prototype status:** Share A is unencrypted in browser storage; the identity check, sanctions list and notifications are mocks (the rules around them are real code).

## In one sentence (for the pitch)

> To steal Anna's money you need two of three very different things: her phone, her kit with its password, or Swissquote's share. Swissquote alone can do nothing, an attacker with her phone and e-mail is refused, and if someone does try to take over, Anna gets 48 hours and a Cancel button.
