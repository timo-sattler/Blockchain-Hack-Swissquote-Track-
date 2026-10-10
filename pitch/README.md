# pitch/ — Demo script and pitch material

- Slides: the live presentation at `/present.html` (keys: → next, ← back, `f` full screen, `c` clear the feed, `s` simulated run).
- `ai-tools.md`: AI tools used. `architecture.png`: architecture diagram.

**The story in one sentence:** one key, three parts, any two sign: Swissquote, your phone or laptop, and a USB stick. Going through Swissquote is safer and free, but Swissquote can never move your money or lock you out.

## Before the demo (15 minutes ahead)

1. **Start everything:** `scripts/start-demo.sh --tunnel`. All lines should show ✓. Note the public link. Do not restart the tunnel afterwards: passkeys are bound to that address.
2. **Projector:** open `<public link>/present.html`, press `f` (full screen) and `c` (clear the feed).
3. **Demo device:** open `<public link>` (always the same address you created the wallet on) → **Crypto** tab → your wallet.
4. **Fund the wallet** (copy its `0x…` address from the wallet card):
   - test USDC: https://faucet.circle.com → Base Sepolia (for the free payment);
   - a little test ETH: https://portal.cdp.coinbase.com/products/faucet → Base Sepolia (only for the "Swissquote down" payment, which pays its own fee).
   Wait until the balance shows in the app.
5. **Recovery kit:** have the kit file (`swissquote-recovery-kit-….json`, usually in Downloads) on the USB stick, and know its password.
6. **Treasury:** the start script prints it; it needs a little ETH for free payments (0.0005 ETH is plenty).
7. Have a recipient address ready, e.g. a teammate's wallet.

## Live demo (about 5 minutes)

| # | Click | Say |
|---|---|---|
| 1 | Slides: problem → **Our answer** (triangle) | "One key, three parts: Swissquote, your device, your USB stick. Any two sign. The whole key never exists anywhere." |
| 2 | App: show **Who holds your key shares** (A this device, B Swissquote, C recovery kit) and the Bitcoin + Base addresses | "Same key on Bitcoin and every EVM chain." |
| 3 | **Send** → USDC → `1` → recipient → fee row says *Free · paid by Swissquote* → **Confirm with passkey** → Touch ID → success → *See it on the blockchain* | "Face ID for every payment. Swissquote checks it, co-signs and pays the network fee." |
| 4 | **Send** → USDC → `1` → **Demo: use a known scam address** → **Confirm with passkey** → red **Blocked by Swissquote**. Point at the feed: *Payment blocked* | "Every recipient is screened. Nothing was signed, no money moved." |
| 5 | Terminal: `kill $(lsof -ti tcp:8790)` (feed: *Swissquote offline*). **Send** → USDC → `1` → recipient → **Sign with my recovery kit instead** → kit file + password → success | "Swissquote is never a gatekeeper: device + USB still sign. And the app still screens, with its copy of Swissquote's list." |
| 6 | Terminal: `scripts/start-demo.sh` (restarts only the share service) | |
| 7 | App: **Remove wallet from this device (simulate a lost phone)** → OK | "Device lost." |
| 8 | **Recover with your kit** → kit file + password → **Continue** → **Attacker with …'s phone + e-mail** → refused | "An attacker with your phone and e-mail is refused, and you get an alert." |
| 9 | **Recover with your kit** again → kit + password → **Take selfie as …** → safety delay (30 s in the demo) | "In production 48 hours, and every old device gets a red alert with a cancel button." |
| 10 | **Create passkey and restore** → Touch ID → save the **new** kit → same addresses and balance | "Same addresses, the old kit is now worthless. Recovery never moved the money." |
| 11 | Slides: custody, legal, business | "Swissquote alone can't move funds, can't lock you out, and the wallet is ownership-verified from the first second." |

Optional, if time allows: **Backups for friends** on two other devices (on-chain backup and give-back), or the escrow agent (Swissquote gone + device lost).

## If something goes wrong

- **Network or chain is slow:** press `s` in the presentation for the simulated run (marked SIMULATED).
- **"Swissquote can't co-sign right now"** when you did not stop it: run `scripts/start-demo.sh` again.
- **Tunnel died:** `scripts/start-demo.sh --tunnel` gives a new link; wallets created on the old link need **Recover with your kit** there.
- **Free payment fails with "treasury has no testnet ETH":** fund the treasury address the start script prints.
- **Kit payment fails with insufficient funds:** the wallet needs a little test ETH (step 4 above).
- After a recovery, only the **new** kit works.
