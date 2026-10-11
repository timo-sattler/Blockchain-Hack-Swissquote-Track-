# pitch/: demo script and pitch material

- [`tech/tech-slides.md`](tech/tech-slides.md): the technical slides (convert with pandoc, see the file), diagrams in [`tech/img/`](tech/img/).
- [`ai-tools.md`](ai-tools.md): AI tools used (required in the submission).
- Step-by-step instructions for every feature: [`../GUIDE.md`](../GUIDE.md).

**The story in one sentence:** your key in three parts: one on your phone behind Face ID, one at Swissquote, one on a paper card. Swissquote checks every payment and pays the fee for stablecoins, but can never move your money alone, and if you lose your phone you get the same wallet back.

## Before the demo (15 minutes ahead)

1. `npm run reset` (with the demo stopped), then `npm run demo:fast` and, for the phone, `npm run tunnel`. `npm run status` should show three ✓.
2. **Fund it:** the treasury address from `npm run status` needs a little Sepolia ETH (free transfers, top-ups). After creating the wallet, top it up from the Swissquote account and get test USDC at https://faucet.circle.com (Ethereum Sepolia).
3. **Laptop:** create Anna's wallet (`SQ-100234` / `Demo-1234`) on the tunnel link, keep the Recovery Card words in a text file.
4. **Second browser window** (private window) for the attacker; **third tab** with the KYC console (`/portal/kyc.html`, PIN `kyc-demo`).

## Live demo (about 5 minutes): create → sign → lose → recover

| # | Click | Say |
|---|---|---|
| 1 | Home: **Portfolio**, the badges **MPC 2 of 3** and **Travel Rule ✓** | "Created a minute ago: Swissquote login, a reference photo, Face ID. The key was made in three parts; it never existed in one place. Swissquote already has proof the wallet is hers." |
| 2 | **Send** → USDC → a teammate's address → **Review** → *Swissquote pays the network fee* → **Approve with Face ID** → explorer link | "Swissquote screened the recipient and co-signed. She owns no ETH: Swissquote paid the fee." |
| 3 | **Send** → **Demo: sanctioned address** → **Review** | "Refused before anything is signed." |
| 4 | **Apps** → **Unknown app asks for unlimited USDC** | "The classic wallet drainer. Swissquote explains it in plain words and refuses." Optional: **Wrap** 0.0005 ETH → effects → Face ID |
| 5 | Attacker window: **I lost my device** → login with password + SMS → selfie → **Start recovery**. KYC tab: **Mismatch, reject** | "A thief with her phone gets her SMS and e-mail codes. The identity check stops him." |
| 6 | Laptop: **Profile** → **Remove wallet from this device** | "Now she really loses her phone." |
| 7 | **I lost my device** → login → **My paper Recovery Card** → selfie → KYC tab: **Same person, approve** → wait 15 s → card words → Face ID | "Real recovery: identity check, a waiting period she could cancel, and one part only she has. New card, same address, same money." |
| 8 | Slide: **You are never locked in** | "If Swissquote disappears, a notary releases its part and an open-source tool moves everything." |

## If something goes wrong

- "Fee account is empty": fund the treasury, or untick *Swissquote pays the network fee*.
- "A recovery started on … is still open": KYC console → **Close recovery**.
- Phone can't open the QR link: run `npm run tunnel`, then create a new QR code.
- More: [`../GUIDE.md`](../GUIDE.md) section 13.
