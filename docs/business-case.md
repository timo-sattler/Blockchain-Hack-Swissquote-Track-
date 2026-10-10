# Business case

## In one paragraph

Today, a Swissquote client who wants to hold their own keys withdraws their crypto to an external wallet (Ledger, MetaMask, an exchange app) and leaves. Every later trade, swap or sale of those coins happens somewhere else, and every withdrawal costs Swissquote a manual Travel Rule ownership check. The Swissquote Wallet keeps those clients one tap away: the coins are theirs, but buying, selling and moving back to the trading account happen inside the Swissquote app. Swissquote earns the trading margin on the return flow, can charge for premium recovery and inheritance services, removes the manual wallet-verification work for these withdrawals, and carries none of the custody burden for assets clients hold themselves, while offering what no Swiss bank offers today: self-custody with bank-grade recovery, for Bitcoin and EVM assets with one key.

## Value for the client

| Today (external wallet) | With the Swissquote Wallet |
|---|---|
| 12 or 24 seed words to write down and never lose | Face ID; an encrypted recovery kit file; no seed words |
| Lose the phone and the paper: funds gone | Lose the phone: recover with kit + identity check |
| Phone and e-mail stolen: attacker may get in | Attacker is refused (demo); the real owner can cancel any recovery |
| Separate apps for Bitcoin and Ethereum | One wallet, one key, Bitcoin and EVM |
| Manual proof of wallet ownership for every transfer from Swissquote | Recognised automatically: Swissquote co-created the wallet |
| No help against scams | Every co-signed payment screened against sanctions lists; extra confirmation for large amounts |
| If Swissquote is down, nothing to do with it | Phone + kit sign without Swissquote |

## Value for Swissquote

| Lever | Mechanism | Type |
|---|---|---|
| **Retention of assets and trading** | Coins that leave for an external wallet are gone for good. Coins in the Swissquote Wallet are one tap from the trading account: sales, swaps and rebalancing flow back through Swissquote's order book | Revenue |
| **New clients** | Crypto-native users who insist on self-custody but want recovery and a Swiss counterparty | Revenue |
| **Premium services** | Inheritance / estate recovery (escrow of Share B with a notary), extended recovery support, higher limits | Revenue (subscription) |
| **Future: card payments** | Pay with a Swissquote card from the self-custody wallet (designed in [`card-payments.md`](card-payments.md)) | Revenue (interchange) |
| **No manual wallet verification** | Ownership is known by construction (see [`legal-compliance.md`](legal-compliance.md)): no signed messages, test transfers or screenshots to review | Cost saving |
| **No custody burden** | Self-custodied assets need no cold storage, no segregation and no insurance on Swissquote's side | Cost avoided |
| **Positioning** | The first Swiss bank offering self-custody with recovery, before competitors | Strategic |

## Illustrative model (replace the assumptions with Swissquote data)

None of the inputs below are Swissquote figures. They show how the levers add up and which numbers to look up internally.

| Input | Assumption | Note |
|---|---:|---|
| Clients withdrawing crypto to external wallets per year | 20 000 | Internal data: withdrawals to external addresses |
| Average amount withdrawn per client | CHF 10 000 | Internal data |
| Share of those withdrawals that go to the Swissquote Wallet instead | 40 % | Adoption target |
| Share of wallet balance traded back through Swissquote per year | 25 % | Behavioural assumption |
| Trading margin on that flow | 1.0 % | Spread + commission |
| Premium recovery / inheritance subscription | 5 % of wallet users at CHF 60 / year | Pricing assumption |
| Manual ownership checks avoided | 1 per client per year, 15 min at CHF 90 / h | Ops assumption |

| Result | Calculation | Per year |
|---|---|---:|
| Assets kept in the ecosystem | 20 000 × 10 000 × 40 % | CHF 80 M |
| Trading revenue on return flow | 80 M × 25 % × 1.0 % | CHF 200 000 |
| Premium subscriptions | 8 000 wallet users × 5 % × 60 | CHF 24 000 |
| Ops time saved on ownership checks | 8 000 × 0.25 h × 90 | CHF 180 000 |
| **Total gain (excluding new clients and card)** | | **≈ CHF 404 000** |

**Costs to set against it:** the share service in an HSM environment (Swissquote already runs signing infrastructure), a commercial licence for the MPC library, identity checks for recoveries (rare events), and, if gasless USDC is added, network fees on Base (fractions of a cent per transfer). The biggest effect is not in the table: every client who would otherwise have left with their coins stays a Swissquote client.

## KPIs for a pilot

- Share of crypto withdrawals that go to the Swissquote Wallet instead of external addresses
- Assets held in Swissquote Wallets, and the share traded back through Swissquote within 12 months
- Time from "lost phone" to recovered wallet; recoveries refused as fraudulent
- Support tickets and manual compliance checks per 1 000 withdrawals, before and after
