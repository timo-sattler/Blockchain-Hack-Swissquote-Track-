# Swissquote Wallet: step-by-step guide

How to start the demo, use the wallet on a computer and on an iPhone, and show every feature. No crypto background needed. For how it works inside, see the [README](README.md).

**What you are showing.** A self-custody wallet linked to a Swissquote account. Its key is split into three parts and never exists in one place:

- **Part A** is on your device, unlocked with Face ID (or a wallet password).
- **Part B** is at Swissquote. It co-signs a payment only after checking the recipient.
- **Part C** is locked by your paper **Recovery Card** (24 words).

Any two parts can sign. Swissquote alone never can.

**Demo logins** (the SMS code is shown on screen; nothing is really sent):

| Client | Client ID | Password |
|---|---|---|
| Anna Keller | `SQ-100234` | `Demo-1234` |
| Marco Rossi | `SQ-100777` | `Demo-5678` |

---

## 1. Set up (once)

1. Install **Node.js 22 or newer** from nodejs.org.
2. Open a terminal in the project folder and run:
   ```bash
   npm install
   ```
3. Use **Chrome, Edge or Safari**. Your computer needs Touch ID, Face ID, Windows Hello or a device PIN for passkeys.

## 2. Start the demo

1. In the project folder, run:
   ```bash
   npm run demo:fast
   ```
   This starts the bank (port 4000), the share vault (4100) and the app (5173). `demo:fast` shortens the recovery security delay to 15 seconds. Use `npm run demo` for the realistic 90 seconds.
2. Open **http://localhost:5173**.
3. Keep the terminal open. Press **Ctrl+C** to stop.

Starting over with no wallets: stop the demo, run `npm run reset`, start again, and clear the browser's site data for the app (or use a private window).

Checking that everything runs: in a second terminal, `npm run status`.

## 3. Open it on an iPhone

Passkeys (Face ID) only work over **https**, so the phone needs a secure link to your computer.

1. With the demo running, open a second terminal and run:
   ```bash
   npm run tunnel
   ```
2. It prints a link like `https://something.trycloudflare.com`. Open that link in **Safari** on the iPhone.
3. Tap **Share** (the square with the arrow), then **Add to Home Screen**, then **Add**. The wallet now has its own icon and opens full screen, like an app.
4. Open it from the home screen icon.

Good to know:
- A passkey works only on the web address where it was created. A wallet made on the tunnel link opens only on that link. A wallet made on http://localhost:5173 can still add the phone, because the "Add a device" QR code uses the tunnel link while the tunnel runs (section 7).
- Keep the tunnel running. Every new `npm run tunnel` gives a new address, and wallets made on the old address can't log in there.
- Face ID unlocks Part A directly on iOS 18 or newer. On older iOS the app asks you to set a **wallet password** instead, and Face ID is still used to approve payments.

## 4. Create a wallet

1. Tap **Create my Swissquote Wallet**.
2. Log in: client ID, password, **Continue**. Type the 6-digit code from the orange **MOCK SMS** box and tap **Log in**.
3. **Reference photo:** tap **Take reference photo**, then **Capture**, then **Continue**. This stands in for the passport photo Swissquote already has. It is used later if you lose your phone.
4. Tap **Protect with Face ID** and confirm. The key is now created in three parts together with Swissquote. This takes a few seconds.
5. **Your paper Recovery Card:** write down the 24 words, or tap **Print** / **Download**. On iPhone, Download opens the share sheet: choose **Save to Files**. Then type the word it asks for and tap **Continue**.
6. Tap **Open my wallet**, then **Unlock with Face ID**.

You now see your wallet. **Portfolio** shows the total value, your address, the badges **Your keys · MPC 2 of 3** and **Travel Rule ✓** (Swissquote has proof the wallet is yours) and your assets (ETH, USDC, EURC). **Activity** lists your transactions; tap one to open it on the explorer. **Security** shows where the three key parts are and Swissquote's security notifications.

## 5. Get test money

All money in the demo is free test money on the Sepolia test network.

- **Test ETH:** on Home, tap the address to copy it, then use one of the faucet links in the blue box.
- **From your Swissquote account:** on Home, **Top up from your Swissquote account** moves test ETH from the bank to your wallet. This needs the bank's treasury to hold test ETH. `npm run status` shows the treasury address; send it Sepolia ETH from a faucet once.
- **Test USDC and EURC:** https://faucet.circle.com, choose **Ethereum Sepolia**, paste your address.

## 6. Send money

### ETH
1. Tap **Send** (in the tab bar or on Home). **ETH** is selected.
2. Paste the recipient address, enter an amount, tap **Review payment**.
3. Check the summary. Swissquote has already screened the recipient (green ✓).
4. Tap **Approve with Face ID**. Your phone and Swissquote co-sign, and the payment is sent. Tap **View on the explorer** to see it on the blockchain.

### USDC or EURC, free
1. In **Send**, tap **USDC** or **EURC**.
2. Leave **Swissquote pays the network fee** ticked. You need no ETH at all.
3. **Review payment**, then **Approve with Face ID**. Swissquote submits the transfer and pays the fee (up to 10 free transfers a day).

If it says the fee account is empty, the bank treasury needs test ETH (see step 5), or untick the box and pay the fee yourself in ETH.

### A large payment
Payments of CHF 20 or more (demo threshold) also need an SMS code: approve with Face ID, then type the code from the **MOCK SMS** box and tap **Co-sign & send**.

### A blocked payment
In **Send**, tap the chip **Demo: sanctioned address**, enter any amount, tap **Review payment**. Swissquote refuses: the address is on a sanctions list, and nothing is ever signed.

### A DeFi app (Apps)
1. On Home, tap **Apps**.
2. Under **Wrapped Ether**, choose **Wrap**, enter an amount (for example `0.0005`) and tap **Check with Swissquote**.
3. **What will happen** explains the request in plain words ("0.0005 ETH leaves your wallet, 0.0005 WETH arrives"), and **Swissquote's checks** shows the approved dApp, the request and the successful dry run on Sepolia.
4. Tap **Approve with Face ID**. The wallet now holds WETH (it appears on Home); **Unwrap** turns it back into ETH.

To show the protection, tap one of the **Try a risky request** buttons: **Unknown app asks for unlimited USDC** or **Call an unknown contract**. Swissquote explains what the request would do ("could take ALL your USDC") and refuses it; nothing is signed.

## 7. Add a second device (for example your iPhone)

Adding a phone to a wallet made on the computer at http://localhost:5173: run `npm run tunnel` first (section 3). A phone can't open the computer's localhost, so the QR code then points to the tunnel's https address instead. The phone gets its own passkey on that address and the computer keeps using localhost.

1. On the device that has the wallet: **Profile** tab → **Devices** → **Add a device**, and confirm with Face ID. A QR code appears. If it warns that the link points to localhost, the tunnel isn't running: start it, tap **Done** and **Add a device** again.
2. On the new device: scan the QR code with the camera (or open the copied link).
3. Log in with client ID, password and SMS code.
4. Tap **Protect with Face ID**, then **Unlock with Face ID**. Same wallet, same address. The new device has its own passkey and its own copy of Part A.

The QR code works once and for 10 minutes. Show it only to yourself.

## 8. Remove a lost device

On a device you still have: **Profile** → **Devices** → **Remove** next to the lost one. Swissquote stops accepting that device's passkey, so it can no longer approve any payment, and its copy of Part A is useless.

## 9. Recover the wallet after losing everything

To rehearse, on a device: **Profile** → **Remove wallet from this device (simulate losing it)**.

1. Tap **I lost my device. Recover my wallet** and log in (client ID, password, SMS).
2. **What do you still have?** Choose one:
   - **My passkey (synced):** your iCloud Keychain / Google Password Manager still has the passkey.
   - **My encrypted backup file:** the file you downloaded, plus its wallet password.
   - **My paper Recovery Card:** the 24 words.
3. Take a **selfie** and tap **Start recovery**.
4. **Identity check (you play the Swissquote specialist):** open `/portal/kyc.html` on the same address (for example http://localhost:5173/portal/kyc.html), PIN `kyc-demo`, **Log in**, compare the photos, tap **Same person, approve**.
5. Back in the wallet, wait for the **security delay** to count down (15 s with `demo:fast`), then tap **Continue**.
6. Give the part you still have: **Unlock with Face ID**, or load the backup file and password and tap **Open my backup**, or type or load your card's words and tap **Continue**.
7. Tap **Protect with Face ID** for this device.
8. You get a **new Recovery Card**: write it down and destroy the old one. **Open my wallet**: same address, same money.

All three key parts were replaced. The lost device and the old card no longer work with Swissquote.

## 10. Stop an attacker who has your phone and e-mail

The attacker has stolen the phone, so they receive your SMS and e-mail codes. They still can't take the wallet:

1. **The phone itself is useless to them.** Part A on it opens only with your Face ID. On another device (or in eBanking at `/portal/`), tap **Report lost** next to the phone: Swissquote stops accepting it.
2. **The attacker tries a recovery.** On a second browser (the "attacker"), tap **I lost my device. Recover my wallet**, log in (they have the password and the SMS code), choose any option, take a selfie and tap **Start recovery**.
3. **The identity check refuses them.** In the KYC console (`/portal/kyc.html`, PIN `kyc-demo`), the selfie doesn't match the photo on file: tap **Mismatch, reject**. The attacker's screen shows **Recovery refused**.
4. **Even if they fooled the check,** you are alerted during the security delay: on your device, Home shows a red banner **Someone is trying to recover your wallet**. Tap **That wasn't me. Block it** (or **Cancel and freeze** in eBanking). The recovery is cancelled and new recoveries are frozen. A Swissquote operator can lift the freeze in the KYC console after calling you back.
5. **And even then,** a recovery needs one of your parts (passkey, backup file or Recovery Card), which the attacker doesn't have.

## 11. Without Swissquote

**Swissquote is offline.** When unlocking fails because Swissquote can't be reached, the unlock screen offers **Continue without Swissquote**. You can still send: in the review step, type your Recovery Card's 24 words. Your device then signs with Part A and Part C alone. No screening, no free transfers.

**Swissquote has closed for good.** An independent notary releases its copy of Part B. With any two parts, the open-source tool moves everything to a new wallet:
```bash
npm run recover-offline -- --client SQ-100234 --card swissquote-recovery-card-SQ-100234.txt --to 0xYOUR_NEW_ADDRESS
```
Run `npm run recover-offline` without options to see all combinations (card + backup file, backup file + escrow, …). Add `--dry-run` to sign without sending.

## 12. Behind the scenes (MOCK consoles)

All links open on the app's address (for example http://localhost:5173):

| Page | What it shows |
|---|---|
| `/portal/` | eBanking: the client's account, linked wallet, devices, recoveries; cancel a recovery |
| `/portal/kyc.html` | KYC operator console (PIN `kyc-demo`): approve or reject recoveries, close a stuck one, lift freezes |
| `/portal/outbox.html` | Every mock SMS, e-mail and push message |

From a terminal: `npm run kyc -- approve` approves the latest waiting recovery.

## 13. Troubleshooting

| Problem | Fix |
|---|---|
| "Passkeys need a secure page" | Use http://localhost:5173 on the computer, or the `npm run tunnel` https link on a phone. Not an IP address. |
| The passkey prompt doesn't appear or is cancelled | Make sure Face ID / Touch ID / Windows Hello is set up. On a computer without it, pick "Use a phone or tablet" in the dialog. |
| "No passkey for this client was created on …" | You opened a different address than the one the wallet was made on. Use the same address, or recover the wallet here. |
| "You already have a Swissquote Wallet" | This client already has one. Use **Recover my wallet**, log in as the other client, or run `npm run reset`. |
| Free transfer: "fee account is empty" | Send Sepolia ETH to the treasury address from `npm run status`. |
| The terminal warns about "the earlier Shamir version" | Old demo data: stop, `npm run reset`, start again. |
| "Port … is already in use" | The demo is already running in another terminal. Stop that one first. |
| "A recovery started on … is still open" | An earlier recovery wasn't finished. On a device that still has the wallet: Home → **It was me, discard it**. Without one: KYC console → **Close recovery**. Or wait until the time it names. |
| Phone can't connect when opening an "Add a device" QR code | The link points to localhost. Run `npm run tunnel`, then make a new QR code. |
