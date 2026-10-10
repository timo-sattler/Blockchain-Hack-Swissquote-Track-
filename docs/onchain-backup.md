# On-chain backup between friends

> For the case **phone and kit both lost**. Friends hold the data, the client holds the secret. Plain-language version: [`handbook.md`](handbook.md) §4.6.

Contract: [`contracts/src/KitBackupMailbox.sol`](../contracts/src/KitBackupMailbox.sol), deployed on Base Sepolia at [`0x52f41590EE5bD2a9912A58433F1868482860C4dD`](https://sepolia.basescan.org/address/0x52f41590EE5bD2a9912A58433F1868482860C4dD). It holds no funds, has no owner and stores only ciphertext. Swissquote's treasury pays the gas; authority comes only from signatures the contract checks itself.

## Who holds what

| Holder | Holds | Can do alone |
|---|---|---|
| Each friend (another Swissquote wallet) | An inbox key on their phone; one **unlock piece**, encrypted so only they can read it | Nothing: one piece reveals nothing (Shamir) |
| Any two friends together | Two unlock pieces | Open the sealed kit, which is **still locked with the client's password** |
| The blockchain (public) | Friends' inbox public keys; the client's kit, sealed and password-locked; the encrypted pieces | Nothing: everything is ciphertext |
| The client | The kit password | Combined with 2 pieces: rebuild the kit, then run the normal recovery |
| Swissquote | Share B, as always | Nothing extra: it cannot read pieces, and cannot swap a friend's inbox key (see below) |

## The three steps

**1. A friend turns on "Hold backups for friends"** (once, one Face ID).
- Their phone creates a P-256 inbox key (WebCrypto).
- Their **wallet** signs the EIP-712 message `InboxKey(owner, key, nonce)` with phone + Swissquote. The contract only accepts the key if `ecrecover` returns the friend's own address.
- **Why this matters:** Swissquote co-signs for every wallet but holds only one of its shares. It cannot produce this signature alone, so it cannot swap in an inbox key of its own and collect the pieces. A nonce stops replays of an old key.

**2. The client backs up the kit** (right after saving it, one Face ID).
1. The kit share is gzip-compressed (247 KB → 166 KB) and locked with the **kit password** (PBKDF2-SHA256, 310,000 rounds + AES-GCM).
2. The locked kit is sealed once more with a random 256-bit key K (AES-GCM) and cut into chunks of at most 96 KB, so each fits in one transaction.
3. K is split with Shamir's secret sharing (audited `shamir-secret-sharing` library), any 2 of the friends' pieces.
4. Each piece (plus the kit's public data: wallet ID, public key, addresses, client name) is encrypted to that friend's inbox key: ECIES = ephemeral ECDH P-256 + HKDF-SHA256 + AES-GCM.
5. The wallet signs `Backup(wallet, setId, kitHash, kitChunks, friends[], piecesHash, nonce)` with phone + Swissquote. `kitHash` is a chained hash over the chunks; `piecesHash` covers every encrypted piece.
6. The treasury submits `createBackup` and then the chunks. The contract checks the wallet's signature, stores the pieces, and marks the backup complete only if the uploaded chunks hash to the signed `kitHash`.

**3. Phone and kit lost: friends give their pieces back.**
1. The new phone creates a one-time P-256 key and shows a link `…/#give-back=<public key>` plus a 6-digit **safety code** derived from that key.
2. The client sends the link to the friends and reads them the code on the phone.
3. A friend opens the link in their Swissquote app. It shows the same code and **Give Anna the piece back**. The app decrypts the friend's piece with the inbox key, re-encrypts it to the one-time key and posts it with `returnPiece` (treasury pays).
4. The new phone reads the returned pieces from the contract. With 2 of them it rebuilds K, fetches the chunks from the `KitChunk` events at the recorded blocks, checks them against `kitHash`, opens the sealed kit and asks for the **kit password**.
5. Then the normal recovery runs: identity check, 48 h waiting period with owner veto, new passkey, new kit. Addresses stay the same.

## What Swissquote co-signs, and what it refuses

The share service rebuilds both messages itself (`services/backup-mailbox.mjs`) and signs only these two types for this one contract: never an arbitrary hash. Relays require the message to have been approved in the same passkey session, like the gasless USDC relay. Give-backs need no login (they are encrypted to the recovering phone), are rate-limited at the relay, and capped at 8 per request by the contract.

## Threats and answers

| Threat | Answer |
|---|---|
| Swissquote swaps a friend's inbox key to collect pieces | The contract only accepts a key signed by the friend's wallet; Swissquote cannot sign alone |
| Two friends collude | They get the kit still locked with the client's password. Only offline password guessing remains, slowed by PBKDF2; a recovery would still need identity check, delay and no veto |
| Someone sends friends a fake give-back link | The safety code, checked by phone. Even if two friends are fooled, the attacker only gets the password-locked kit |
| Garbage posted to a request (denial of service) | Unreadable pieces are ignored; at most 8 per request; the client makes a new request |
| Ciphertext stays public forever | Two layers (friend encryption, then password). **Replacing the kit** issues new shares, so an old backup unlocks only a share that no longer works |
| A friend loses their phone | Their inbox key, and so their piece, is gone. With 3 friends, any 2 still suffice; the client can make a new backup |
| Friends' addresses are publicly linked to the client's wallet | Accepted for the prototype; production could use dedicated inbox addresses (see [`legal-compliance.md`](legal-compliance.md) §4) |

## Real vs. mocked, and evidence

- **Real:** contract (deployed), EIP-712 signatures by the MPC wallet, P-256 encryption, Shamir split, password lock, on-chain storage and reads, treasury relays.
- **Tests:** 11 Foundry tests (`cd contracts && forge test`): only the friend's own signature sets an inbox key, no replay, the backup needs the wallet's signature, swapped pieces break it, only the uploader adds chunks, wrong kit data never completes, set IDs cannot be taken over, returns are capped.
- **End to end** (headless Chrome, virtual passkeys, local chain with Base Sepolia's chain ID): Ben and Carla turn on backups → Anna backs up to both → Ben's app shows "Piece 1 of 2 for Anna Muster" → Anna's new phone sends a link → both friends see the same safety code and give back → wrong password refused → right password rebuilds the kit → identity check, delay, restore → same Bitcoin and EVM addresses.
- **Live on Base Sepolia:** contract deployed; a funded treasury is needed for the relays (about 0.00005 ETH per backup, mostly the two kit chunks).

## Limits

- Inbox keys and the one-time recovery key sit in `localStorage`, like Share A in the prototype.
- If Swissquote is gone, nobody pays the gas for give-backs; in production a friend could submit `returnPiece` from their own wallet (the contract accepts anyone as sender).
- Mixing on-chain pieces with piece files in one recovery is not supported.
