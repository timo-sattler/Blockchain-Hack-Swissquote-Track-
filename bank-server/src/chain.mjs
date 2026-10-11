// Real Ethereum connectivity (public RPC) + the bank's treasury hot wallet used for
// "Transfer from my Swissquote account to my Swissquote Wallet" and for paying the network fee of
// gasless USDC / EURC transfers (EIP-3009 transferWithAuthorization, relayed by Swissquote).
// The network is chosen with CHAIN=sepolia (default, free test ETH) or CHAIN=mainnet (real ETH).
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { DATA_DIR } from "./store.mjs";

const NETWORKS = {
  sepolia: {
    key: "sepolia",
    chainId: 11155111,
    name: "Sepolia testnet",
    symbol: "ETH",
    testnet: true,
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org", "https://0xrpc.io/sep"],
    explorer: "https://sepolia.etherscan.io",
    blockscout: "https://eth-sepolia.blockscout.com",
    faucets: ["https://cloud.google.com/application/web3/faucet/ethereum/sepolia", "https://sepolia-faucet.pk910.de"],
    // Swissquote-approved dApps on this network. Unknown contracts get a warning.
    approvedDapps: {
      "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14": "WETH (Uniswap, Sepolia)",
      "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238": "USDC (Circle, Sepolia)",
      "0x000000000022D473030F116dDEE9F6B43aC78BA3": "Uniswap Permit2",
    },
    // dApps the wallet can call (see dapps.mjs): WETH wraps ETH; Permit2 may receive limited token
    // approvals (Uniswap's approval contract).
    dapps: [
      { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", kind: "weth", name: "WETH", title: "Wrapped Ether" },
      { address: "0x000000000022D473030F116dDEE9F6B43aC78BA3", kind: "spender", name: "Uniswap Permit2", title: "Uniswap's approval contract" },
    ],
    demoAddresses: [
      { label: "Demo: sanctioned address", addr: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96" },
      { label: "Demo: unknown contract", addr: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9" },
    ],
    // Circle's test stablecoins. Both implement EIP-3009, so Swissquote can pay their network fee.
    // `name`/`version` are the EIP-712 domain; `chf` is a MOCK conversion rate for limits.
    tokens: {
      USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", name: "USDC", version: "2", decimals: 6, chf: 0.85 },
      EURC: { address: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4", name: "EURC", version: "2", decimals: 6, chf: 0.94 },
    },
    tokenFaucet: "https://faucet.circle.com",
  },
  mainnet: {
    key: "mainnet",
    chainId: 1,
    name: "Ethereum mainnet",
    symbol: "ETH",
    testnet: false,
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
    explorer: "https://etherscan.io",
    blockscout: "https://eth.blockscout.com",
    faucets: [],
    approvedDapps: {
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "WETH (Wrapped Ether)",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "USDC (Circle)",
      "0x000000000022D473030F116dDEE9F6B43aC78BA3": "Uniswap Permit2",
    },
    dapps: [
      { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", kind: "weth", name: "WETH", title: "Wrapped Ether" },
      { address: "0x000000000022D473030F116dDEE9F6B43aC78BA3", kind: "spender", name: "Uniswap Permit2", title: "Uniswap's approval contract" },
    ],
    demoAddresses: [],
    tokens: {},
  },
};

const chosen = String(process.env.CHAIN || "sepolia").toLowerCase();
if (!NETWORKS[chosen]) throw new Error(`Unknown CHAIN=${chosen}. Use one of: ${Object.keys(NETWORKS).join(", ")}`);
export const NETWORK = NETWORKS[chosen];
export const CHAIN_ID = NETWORK.chainId;
export const RPC_URL = process.env.RPC_URL || (chosen === "sepolia" && process.env.SEPOLIA_RPC_URL) || NETWORK.rpcUrls[0];
export const RPC_URLS = [RPC_URL, ...NETWORK.rpcUrls.filter((u) => u !== RPC_URL)];
export const EXPLORER = NETWORK.explorer;
export const TOKENS = NETWORK.tokens || {};
export const tokenByAddress = (a) => Object.entries(TOKENS).find(([, t]) => t.address.toLowerCase() === String(a).toLowerCase())?.[0] || null;
export const APPROVED_DAPPS = new Map(Object.entries(NETWORK.approvedDapps).map(([a, n]) => [a.toLowerCase(), n]));

// Bank -> wallet top-ups pay out of the treasury. On mainnet that is real money, so it stays off
// unless the operator explicitly enables it.
export const TREASURY_TOPUP_ENABLED = process.env.TREASURY_TOPUP ? process.env.TREASURY_TOPUP === "1" : NETWORK.testnet;

export const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });

function loadTreasury() {
  if (process.env.TREASURY_PRIVATE_KEY) return new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
  const file = path.join(DATA_DIR, "treasury.json");
  if (fs.existsSync(file)) {
    // Never silently replace an existing treasury key: it may hold funds.
    return new ethers.Wallet(JSON.parse(fs.readFileSync(file, "utf8")).privateKey, provider);
  }
  const w = ethers.Wallet.createRandom();
  fs.writeFileSync(file, JSON.stringify({ note: "MOCK bank treasury hot wallet", address: w.address, privateKey: w.privateKey }, null, 2));
  return new ethers.Wallet(w.privateKey, provider);
}

export const treasury = loadTreasury();

// One treasury transaction at a time, so concurrent top-ups never reuse a nonce.
let treasuryQueue = Promise.resolve();
export function withTreasury(fn) {
  const run = treasuryQueue.then(fn, fn);
  treasuryQueue = run.catch(() => {});
  return run;
}

export async function balanceEth(address) {
  return ethers.formatEther(await provider.getBalance(address));
}

const transferWithAuthorizationAbi = [
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function balanceOf(address) view returns (uint256)",
];

// Gasless USDC / EURC: submits the client's signed authorization; the treasury pays the fee.
export function relayAuthorization(token, message, signature) {
  return withTreasury(async () => {
    const sig = ethers.Signature.from(signature);
    const contract = new ethers.Contract(token, transferWithAuthorizationAbi, treasury);
    const args = [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, sig.v, sig.r, sig.s];
    // Simulate first: the token checks the signature before the balance, so a clear revert reason comes back.
    await contract.transferWithAuthorization.staticCall(...args);
    const tx = await contract.transferWithAuthorization(...args);
    return tx.hash;
  });
}

export async function tokenBalance(token, address) {
  return new ethers.Contract(token, transferWithAuthorizationAbi, provider).balanceOf(address);
}

export const RPC_ALLOW = new Set([
  "eth_call",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_estimateGas",
  "eth_getCode",
  "eth_sendRawTransaction",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
]);
