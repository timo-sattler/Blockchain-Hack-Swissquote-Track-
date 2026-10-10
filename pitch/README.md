# pitch/ — Demo script and pitch material

- Slides: the live presentation at `/present.html` (keys: → next, ← back, `f` full screen, `c` clear the feed, `s` simulated run).
- [`ai-tools.md`](ai-tools.md): AI tools used (required in the submission).
- Architecture diagram: `app/public/architecture.svg` (also on the slides).

**The story in one sentence:** one key, two parts: yours (on your laptop, a copy on your phone, each with Face ID) and Swissquote's. Going through Swissquote is safer and less pricey: it blocks malicious addresses and pays the fee. It can never move your money alone, and if it is ever gone, a six-month grace period gives you full control.

## Before the demo (15 minutes ahead)

1. **Start everything:** `scripts/start-demo.sh --tunnel`. All lines ✓; note the public link and keep the tunnel running (passkeys are bound to that address).
2. **Treasury:** the script prints Swissquote's fee account and balance. It needs a little Base Sepolia ETH for free USDC/EURC transfers.
3. **Projector:** `<public link>/present.html`, press `f` and `c`.
4. **Laptop:** open `<public link>` (not localhost, so the phone can scan its QR codes) → Crypto tab → **Create my wallet**.
5. **Fund the wallet:** test USDC (and EURC) from https://faucet.circle.com (Base Sepolia) to the wallet's `0x…` address.
6. **Phone:** ready to scan a QR code.

## Live demo (about 5 minutes)

| # | Click | Say |
|---|---|---|
| 1 | Slides: problem → **Our answer** | "One key, two parts. Yours on your devices, Swissquote's at the bank. Every payment needs both; the full key never exists." |
| 2 | Laptop: **Your key: two parts**, then **Receive** → *The same key on other networks* | "My part is on this laptop, unlocked with Face ID. USDC, EURC, ETH and Bitcoin today, and addresses on every major network from the same key." |
| 3 | **Send** → USDC → `1` → a teammate's address → *Free · paid by Swissquote* → **Confirm with Face ID** → success | "Swissquote checks it, co-signs and pays the fee." |
| 4 | **Send** → USDC → `1` → **Demo: use a known scam address** → **Confirm with Face ID** → **Blocked by Swissquote**; feed: *Payment blocked* | "Every payment goes through Swissquote's screening, and nobody can skip it: I never hold both parts." |
| 5 | **Add a device** → Face ID → QR code. Phone: scan → **Create passkey and add this device** → Face ID. Laptop: *iPhone added* | "An identical copy of my part, with the phone's own Face ID. Swissquote relayed it but cannot read it." |
| 6 | **Lose:** laptop → **Remove wallet from this device**. Phone: **Remove** next to the laptop | "Laptop stolen. One tap on the phone, and its copy is useless: Swissquote refuses its Face ID." |
| 7 | **Recover:** phone → **Add a device** → QR code. Laptop: open the link → **Create passkey and add this device** | "New laptop, same wallet, same addresses. Access recovered, nothing moved." |
| 8 | **How my key works** on both devices; optional terminal: `cd services && npm run insider` | "Same fingerprint on my devices, a different one at Swissquote, and the escrow holds a copy of Swissquote's. Here Swissquote attacks its own database: it cannot sign." |
| 9 | Terminal: `kill $(lsof -ti tcp:8790)`. Phone: *your wallet is paused* with a countdown → **Take over my wallet** | "If Swissquote ever fails, the wallet pauses. After the grace period, six months in reality, 30 seconds here, the escrow agent hands its copy to my device." |
| 10 | Terminal: `scripts/start-demo.sh` (Swissquote back). Slides: custody, legal, business | "Swissquote can never move your money, and can never trap it." |

## If something goes wrong

- Slow network: press `s` in the presentation for the simulated run.
- Free transfer refused ("fee account is empty"): fund the treasury address the start script prints, or tick **Pay it myself** (the wallet then needs a little ETH).
- Tunnel died: `scripts/start-demo.sh --tunnel` gives a new link; create a new wallet on it.
- The takeover in step 9 ends that wallet's link to Swissquote: create a fresh wallet for the next rehearsal.
