# Business case

## In one paragraph

Today, a Swissquote client who wants to hold their own keys withdraws their crypto to an external wallet (Ledger, MetaMask, an exchange app) and leaves. Every later trade, swap or sale of those coins happens somewhere else, and every withdrawal costs Swissquote a manual Travel Rule ownership check. The Swissquote Wallet keeps those clients one tap away: the coins are theirs, but every payment passes Swissquote's screening, USDC and EURC transfers are free, and buying, selling and moving back to the trading account happen inside the Swissquote app. Swissquote earns the trading margin on the return flow, removes the manual wallet-verification work, and carries none of the custody burden for assets clients hold themselves, while offering what no Swiss bank offers today: self-custody with bank-grade protection, for Bitcoin and every EVM network with one key.

## Value for the client

| Today (external wallet) | With the Swissquote Wallet |
|---|---|
| 12 or 24 seed words to write down and never lose | Face ID; no seed words |
| One device, one point of failure | Identical copies on the laptop and the phone, each with its own Face ID; a lost device is removed in one tap |
| No help against scams | Every payment screened against malicious and sanctioned addresses before it is signed; extra confirmation for large amounts |
| Pay gas in a second coin | USDC and EURC transfers are free: Swissquote pays the fee |
| Separate apps for Bitcoin and Ethereum | One wallet, one key: Bitcoin and every EVM network, plus a euro stablecoin |
| Manual proof of wallet ownership for every transfer from Swissquote | Recognised automatically: Swissquote co-created the wallet |
| A provider failure can trap the funds | Swissquote can never move the funds; if it disappears, the client gets sole control after the grace period |

## Value for Swissquote

| Lever | Mechanism | Type |
|---|---|---|
| **Retention of assets and trading** | Coins that leave for an external wallet are gone for good. Coins in the Swissquote Wallet are one tap from the trading account: sales, swaps and rebalancing flow back through Swissquote's order book | Revenue |
| **New clients** | Crypto-native users who insist on self-custody but want protection against scams and a Swiss counterparty | Revenue |
| **Premium services** | Higher sponsored-transfer limits, more devices, family and business wallets, priority support | Revenue (subscription) |
| **No manual wallet verification** | Ownership is known by construction (see [`legal-compliance.md`](legal-compliance.md)) | Cost saving |
| **No custody burden** | Self-custodied assets need no cold storage, no segregation and no insurance on Swissquote's side | Cost avoided |
| **Compliance by design** | Every payment passes Swissquote's screening, which a regulator can audit | Risk reduction |
| **Positioning** | The first Swiss bank offering self-custody with built-in protection | Strategic |

## Illustrative model (replace the assumptions with Swissquote data)

None of the inputs below are Swissquote figures. They show how the levers add up and which numbers to look up internally.

| Input | Assumption | Note |
|---|---:|---|
| Clients withdrawing crypto to external wallets per year | 20 000 | Internal data: withdrawals to external addresses |
| Average amount withdrawn per client | CHF 10 000 | Internal data |
| Share of those withdrawals that go to the Swissquote Wallet instead | 40 % | Adoption target |
| Share of wallet balance traded back through Swissquote per year | 25 % | Behavioural assumption |
| Trading margin on that flow | 1.0 % | Spread + commission |
| Premium subscription | 5 % of wallet users at CHF 60 / year | Pricing assumption |
| Manual ownership checks avoided | 1 per client per year, 15 min at CHF 90 / h | Ops assumption |
| Sponsored stablecoin transfers | 50 per wallet user per year at CHF 0.01 network fee (Base) | Cost |

| Result | Calculation | Per year |
|---|---|---:|
| Assets kept in the ecosystem | 20 000 × 10 000 × 40 % | CHF 80 M |
| Trading revenue on return flow | 80 M × 25 % × 1.0 % | CHF 200 000 |
| Premium subscriptions | 8 000 wallet users × 5 % × 60 | CHF 24 000 |
| Ops time saved on ownership checks | 8 000 × 0.25 h × 90 | CHF 180 000 |
| Fee sponsoring | 8 000 × 50 × 0.01 | − CHF 4 000 |
| **Net gain (excluding new clients)** | | **≈ CHF 400 000** |

**Other costs:** the share service in an HSM environment (Swissquote already runs signing infrastructure), a commercial licence for the MPC library, the escrow contract with a notary, and a chain-analytics subscription for screening. The biggest effect is not in the table: every client who would otherwise have left with their coins stays a Swissquote client.

## KPIs for a pilot

- Share of crypto withdrawals that go to the Swissquote Wallet instead of external addresses
- Assets held in Swissquote Wallets, and the share traded back through Swissquote within 12 months
- Payments blocked by screening, and fraud reports per 1 000 wallets compared with external wallets
- Share of wallets with a second device; support tickets for lost devices
- Manual compliance checks per 1 000 withdrawals, before and after
