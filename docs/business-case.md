# Business case

## In one paragraph

Today a Swissquote client who wants their own keys withdraws their crypto to Ledger, MetaMask or an exchange app, and leaves: later trades happen elsewhere, and every withdrawal costs Swissquote a manual Travel Rule ownership check. The Swissquote Wallet keeps that client one tap from their account: the keys are theirs, but Face ID replaces seed words, every payment is screened against scams and sanctions, USDC and EURC move for free, and a lost phone is not a lost fortune. Swissquote earns a **recovery subscription** (CHF 4.90 a month, or CHF 99 per recovery), keeps the trading flow of assets that would otherwise have left, removes manual ownership checks, and carries **no custody burden**, because it can never move the funds on its own.

## Value for the client

| Today (external wallet) | With the Swissquote Wallet |
|---|---|
| 24 seed words to keep safe for years | Face ID; a paper card only as a spare |
| Lose the phone and the words: the money is gone (an estimated 2.8–3.8M BTC are lost for good) | Recover with a selfie and any part you still have; same address, same money |
| No help against scams | Every recipient screened; scam dApp requests and unlimited approvals refused, with a plain-language explanation |
| Need ETH to move USDC | Swissquote pays the network fee for USDC and EURC |
| Manual proof of ownership for every transfer from Swissquote | Proven automatically at creation |
| Trust one company completely | Swissquote can't move the funds; the client can always sign without it |

## Value for Swissquote

| Lever | Mechanism | Type |
|---|---|---|
| **Recovery subscription** | CHF 4.90 / month for recovery with identity check, or CHF 99 per recovery without a subscription. Ledger Recover charges USD 9.99 / month and needs a hardware wallet | Revenue |
| **Retention of assets** | Coins stay one tap from the trading account: sales, swaps and rebalancing flow through Swissquote instead of an external exchange | Revenue |
| **New clients** | Self-custody users who want a Swiss counterparty and scam protection | Revenue |
| **No manual ownership checks** | Ownership is proven by construction | Cost saving |
| **No custody burden** | Client-held assets need no cold storage, segregation or insurance | Cost avoided |
| **Compliance by design** | Screening on every co-signed payment and dApp request, auditable | Risk reduction |

## Illustrative numbers (replace with Swissquote data)

| Input | Assumption |
|---|---:|
| Crypto clients who could use the wallet | 55,000 |
| Recovery subscription | CHF 4.90 / month |
| Share of crypto clients withdrawing to external wallets each year | 20 % |
| Average amount withdrawn | CHF 10,000 |
| Share of those withdrawals kept in the Swissquote Wallet instead | 40 % |
| Share of wallet balance traded back through Swissquote per year | 25 % at 1 % margin |
| Sponsored stablecoin transfers | 50 per active wallet per year at CHF 0.05 (on a Layer 2; more on Ethereum mainnet) |

| Result | Calculation | Per year |
|---|---|---:|
| Subscription, upper bound (every crypto client subscribes, as on the pitch slide) | 55,000 × 4.90 × 12 | CHF 3.2M |
| Subscription, 20 % take-up | 11,000 × 4.90 × 12 | CHF 650,000 |
| Assets kept in the ecosystem | 55,000 × 20 % × 10,000 × 40 % | CHF 44M |
| Trading revenue on that flow | 44M × 25 % × 1 % | CHF 110,000 |
| Fee sponsoring | 11,000 × 50 × 0.05 | − CHF 27,500 |

**Costs not in the table:** an HSM-grade vault, the commercial MPC licence, the notary contract, a chain-analytics subscription, KYC operator time per recovery (covered by the CHF 99 fee for non-subscribers).

## KPIs for a pilot

- Share of crypto withdrawals that go to the wallet instead of external addresses
- Subscription take-up; recoveries per 1,000 wallets and their success rate
- Payments and dApp requests blocked by screening; fraud reports versus external wallets
- Manual Travel Rule checks per 1,000 withdrawals, before and after
- Sponsored fees per active wallet
