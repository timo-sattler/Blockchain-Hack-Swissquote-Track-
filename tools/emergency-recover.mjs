#!/usr/bin/env node
// Emergency recovery WITHOUT Swissquote (open-source, needs only a public Ethereum node). The wallet's
// key is an MPC key in three parts; any two sign together here, on this computer:
//   Part C  the client's paper Recovery Card (24 words) — unlocks the encrypted Part C kept in the
//           backup file or the notary escrow                         --card card.txt | --words "..."
//   Part A  the client's encrypted backup file (wallet-password mode) --backup file.json --password "..."
//   Part B  the copy the independent notary escrow releases if Swissquote permanently ceases
//           operations (MOCK: share-vault/data/notary-escrow.json)  --client SQ-100234 [--escrow path]
// There is no seed phrase to print (the whole key never exists), so the tool moves the funds instead:
// it signs transfers of all ETH, USDC and EURC to an address of your choice with Trust Wallet Core.
//
//   node tools/emergency-recover.mjs --client SQ-100234 --card swissquote-recovery-card-SQ-100234.txt
//   node tools/emergency-recover.mjs --client SQ-100234 --card card.txt --to 0xYourNewWallet
//   node tools/emergency-recover.mjs --card card.txt --backup swissquote-encrypted-backup-SQ-100234.json --password "..." --to 0x… --dry-run
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wc from "@trustwallet/wallet-core";
import { ethers } from "ethers";
import { addressOf, cardKeyOfWords, core, finishSignature, hex, openPartAWithPassword, openPartC, partyOf, signTogether, unb64 } from "./lib/mpc-offline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), [])
);
const usage = `usage:
  paper card + notary escrow:   node tools/emergency-recover.mjs --client SQ-100234 --card card.txt [--escrow notary-escrow.json]
  paper card + backup file:     node tools/emergency-recover.mjs --card card.txt --backup backup.json --password "..."
  backup file + notary escrow:  node tools/emergency-recover.mjs --backup backup.json --password "..." --client SQ-100234
  then add --to 0xNEW to move all funds there (--dry-run: sign but don't broadcast; --rpc URL; --chain-id N)
  (instead of --card: --words "word1 ... word24"; the password can also come from WALLET_PASSWORD)`;

function die(msg) {
  console.error(`\n${msg}\n\n${usage}\n`);
  process.exit(1);
}

// Stablecoins on Ethereum Sepolia (the demo network). Other networks: pass --chain-id and --rpc; tokens are skipped.
const SEPOLIA_TOKENS = {
  USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  EURC: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
};

const parts = [];
let clientId = args.client;
let backup = null;
let escrowRec = null;

if (args.backup) {
  if (!fs.existsSync(args.backup)) die(`Backup file not found: ${args.backup}`);
  backup = JSON.parse(fs.readFileSync(args.backup, "utf8"));
  if (backup.kind !== "swissquote-wallet/mpc-backup" || !backup.partA || !backup.publicKey) die("That file isn't a Swissquote wallet backup file (MPC).");
  clientId ??= backup.clientId;
}
if (clientId) {
  const escrowFile = args.escrow || path.join(process.env.VAULT_DATA_DIR || path.resolve(here, "../share-vault/data"), "notary-escrow.json");
  if (fs.existsSync(escrowFile)) escrowRec = JSON.parse(fs.readFileSync(escrowFile, "utf8")).shares?.[clientId] ?? null;
  else if (args.client) die(`Notary escrow file not found: ${escrowFile}`);
}
const publicKeyHex = backup?.publicKey ?? escrowRec?.publicKey;
if (!publicKeyHex) die("Can't tell which wallet this is: add the backup file, or --client with the notary escrow file.");
const publicKey = Uint8Array.from(Buffer.from(publicKeyHex, "hex"));
if (!clientId) die("Add --client (your Swissquote client ID).");

// Part C: the card's 24 words decrypt the encrypted Part C from the backup file or the escrow.
if (args.card || args.words) {
  let words = args.words;
  if (args.card) {
    if (!fs.existsSync(args.card)) die(`Card file not found: ${args.card}`);
    words = [...fs.readFileSync(args.card, "utf8").matchAll(/^\s*\d+\.\s+([a-z]+)\s*$/gim)].map((m) => m[1]).join(" ");
  }
  const encC = backup?.partC ?? escrowRec?.encC;
  if (!encC) die("The card unlocks the encrypted Part C, which is in your backup file or the notary escrow: add one of them.");
  try {
    parts.push({ name: "paper Recovery Card (Part C)", share: openPartC(encC, await cardKeyOfWords(words), clientId, publicKey) });
  } catch (e) {
    die(e.message);
  }
}

if (backup) {
  const password = args.password ?? process.env.WALLET_PASSWORD;
  if (!password || password === true) die("The backup file needs its wallet password (--password or WALLET_PASSWORD).");
  try {
    parts.push({ name: "encrypted backup file (Part A)", share: openPartAWithPassword(backup.partA, password, clientId, publicKeyHex) });
  } catch (e) {
    die(e.message);
  }
}

if (parts.length < 2) {
  if (!escrowRec) die(`Two parts are needed. ${clientId ? `The notary escrow holds no Part B for ${clientId}.` : "Add --client to use the notary escrow copy of Part B."}`);
  parts.push({ name: "notary escrow copy (Part B)", share: unb64(escrowRec.share) });
}

for (const p of parts) {
  if (hex(partyOf(p.share).publicKey) !== publicKeyHex) die(`${p.name} belongs to a different key (an older one, replaced by a recovery?).`);
}
const [one, two] = parts;
const address = addressOf(publicKey);

const { CoinType, AnyAddress, PublicKey, PublicKeyType, TransactionCompiler, DataVector, HexCoding } = await core();
const twPk = PublicKey.createWithData(publicKey, PublicKeyType.secp256k1);
console.log(`\nWallet rebuilt from: ${one.name} + ${two.name}`);
console.log("  Ethereum:", address);
console.log("  Bitcoin: ", AnyAddress.createWithPublicKey(twPk, CoinType.bitcoin).description());

// Proof that these two parts control the wallet: sign and verify a message locally.
const proofHash = ethers.hashMessage(`Swissquote Wallet emergency recovery check ${new Date().toISOString()}`);
finishSignature(ethers.getBytes(proofHash), signTogether(one.share, two.share, ethers.getBytes(proofHash)), address);
console.log("  ✓ The two parts sign together for this address.");

if (!args.to) {
  console.log("\nAdd --to 0xYourNewAddress to move all funds there.\n");
  process.exit(0);
}
if (!ethers.isAddress(args.to)) die("--to must be an Ethereum address.");

const rpcUrl = args.rpc || process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const chainId = Number(args["chain-id"] || 11155111);
const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
const tokens = chainId === 11155111 ? SEPOLIA_TOKENS : {};
const be = (n) => {
  let h = BigInt(n).toString(16);
  if (h.length % 2) h = "0" + h;
  return HexCoding.decode(h);
};
const P = wc.TW.Ethereum.Proto;

// Trust Wallet Core builds the transaction and its hash; the two parts sign; wallet-core compiles.
function signTx(fields) {
  const input = P.SigningInput.encode(
    P.SigningInput.create({
      chainId: be(chainId),
      nonce: be(fields.nonce),
      txMode: P.TransactionMode.Enveloped,
      gasLimit: be(fields.gasLimit),
      maxInclusionFeePerGas: be(fields.tip),
      maxFeePerGas: be(fields.maxFee),
      toAddress: fields.token ?? args.to,
      transaction: P.Transaction.create(
        fields.token
          ? { erc20Transfer: P.Transaction.ERC20Transfer.create({ to: args.to, amount: be(fields.amount) }) }
          : { transfer: P.Transaction.Transfer.create({ amount: be(fields.amount) }) }
      ),
    })
  ).finish();
  const hash = wc.TW.TxCompiler.Proto.PreSigningOutput.decode(TransactionCompiler.preImageHashes(CoinType.ethereum, input)).dataHash;
  const full = finishSignature(hash, signTogether(one.share, two.share, hash), address);
  const sigs = DataVector.create();
  const pubs = DataVector.create();
  sigs.add(full);
  pubs.add(twPk.uncompressed().data());
  const out = P.SigningOutput.decode(TransactionCompiler.compileWithSignatures(CoinType.ethereum, input, sigs, pubs));
  if (out.error) throw new Error(out.errorMessage);
  return ethers.hexlify(out.encoded);
}

const [nonce0, block, tipHex, ethBalance] = await Promise.all([
  provider.getTransactionCount(address, "pending"),
  provider.getBlock("latest"),
  provider.send("eth_maxPriorityFeePerGas", []).catch(() => "0x3b9aca00"),
  provider.getBalance(address),
]);
const tip = BigInt(tipHex) > 0n ? BigInt(tipHex) : 1_000_000_000n;
const maxFee = (block.baseFeePerGas ?? 0n) * 2n + tip;
let nonce = nonce0;
let ethLeft = ethBalance;
const raws = [];
const erc20 = new ethers.Contract(ethers.ZeroAddress, ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256)"], provider);
for (const [symbol, token] of Object.entries(tokens)) {
  const bal = await erc20.attach(token).balanceOf(address);
  if (bal === 0n) continue;
  const gasLimit = 80_000n;
  if (ethLeft < gasLimit * maxFee) {
    console.log(`  ! ${ethers.formatUnits(bal, 6)} ${symbol} stays: not enough ETH for its network fee.`);
    continue;
  }
  raws.push({ what: `${ethers.formatUnits(bal, 6)} ${symbol}`, raw: signTx({ nonce: nonce++, gasLimit, tip, maxFee, token, amount: bal }) });
  ethLeft -= gasLimit * maxFee;
}
const ethFee = 21_000n * maxFee;
if (ethLeft > ethFee) raws.push({ what: `${ethers.formatEther(ethLeft - ethFee)} ETH`, raw: signTx({ nonce: nonce++, gasLimit: 21_000n, tip, maxFee, amount: ethLeft - ethFee }) });

if (!raws.length) {
  console.log(`\nNothing to move: ${address} holds ${ethers.formatEther(ethBalance)} ETH, not enough for a network fee.\n`);
  process.exit(0);
}
console.log(`\n${args["dry-run"] ? "Signed (dry run, not sent)" : "Sending"} to ${args.to}:`);
for (const r of raws) {
  if (args["dry-run"]) {
    console.log(`  ${r.what}\n    ${r.raw}`);
    continue;
  }
  const tx = await provider.broadcastTransaction(r.raw);
  console.log(`  ${r.what}: ${tx.hash}`);
}
console.log();
