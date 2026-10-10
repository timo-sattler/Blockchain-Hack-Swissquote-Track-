# Challenge brief: Swissquote Wallet Challenge (verbatim)

**Prizes:** 1st $1,800 · 2nd $1,100 · 3rd $700

In the Swissquote Wallet Challenge, we want teams to build the self-custody wallet Swissquote could realistically launch for its clients. The goal is to give users full control of their crypto and keys while preserving the security, simplicity, compliance, and user experience they expect from a Swiss bank. Today, clients who want self-custody must withdraw their assets to an external wallet and leave the Swissquote ecosystem. Your challenge is to create a better alternative: their keys, their control, while remaining one step away from their Swissquote account.

Your prototype should demonstrate the complete wallet lifecycle, from wallet creation to authentication, transaction signing, loss of access, and recovery. Teams must make and defend a clear custody model, define a credible threat model, design the wallet architecture, explain where keys or key shares live, and show how users authenticate securely before signing transactions. The recovery mechanism should protect legitimate users without creating an easy path for attackers or giving Swissquote unintended control over client funds. At minimum, your demo must sign and send a real transaction to a blockchain, with testnet deployments fully accepted.

You are free to explore approaches such as MPC or threshold signatures, passkeys and WebAuthn, smart contract accounts using ERC-4337, seed phrases, or split-backup systems such as Shamir or SLIP-39. Use established cryptographic libraries and SDKs rather than implementing your own cryptography. Parts that cannot realistically be built during the hackathon, such as banking infrastructure, compliance providers, or key-share servers, may be mocked as long as the distinction is clearly documented and the system architecture remains credible.

## Bonus points if your project
- implements gasless transactions, so users can transfer assets such as USDC without first acquiring the network's native gas token
- enables compliant dApp interaction, such as approved dApp lists, sanctions screening, transaction simulation, or additional checks for high-value transactions
- provides a recovery flow that can distinguish a legitimate user from an attacker who has compromised their phone or email
- creates a strong business case for Swissquote through revenue, client retention, new users, or lower operational costs
- addresses Swiss regulatory considerations around custody and wallet ownership verification in a technically credible way

## How we will judge
Technical implementation (35), security and custody design (20), legal feasibility (15), business case (15), user experience and pitch (15). Up to 20 additional bonus points for well-executed gasless transactions and compliant dApp interaction, provided the core create → sign → recover experience works end to end.
