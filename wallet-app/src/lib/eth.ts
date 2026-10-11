// Minimal Ethereum JSON-RPC. Talks to public RPCs directly (works even if Swissquote is offline)
// and falls back to the bank's relay. The network comes from the bank's config.
import { cachedConfig } from "./api";
import { txHashOf } from "./walletcore";

let id = 1;
async function direct(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  const j = await res.json();
  if (j.error) throw Object.assign(new Error(j.error.message || "RPC error"), { rpc: true });
  if (!("result" in j)) throw new Error(`RPC ${url} returned no result`);
  return j.result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = any>(method: string, params: unknown[] = []): Promise<T> {
  for (const url of cachedConfig().rpcUrls) {
    try {
      return await direct(url, method, params);
    } catch (e) {
      if ((e as { rpc?: boolean }).rpc) throw e;
    }
  }
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) throw new Error("No Ethereum node is reachable. Check your internet connection.");
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "RPC relay error");
  return j.result;
}

export const toBig = (hex: string) => BigInt(hex);
export const hex = (n: bigint) => `0x${n.toString(16)}`;

export function formatEth(wei: bigint, digits = 6): string {
  const neg = wei < 0n;
  const w = neg ? -wei : wei;
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function parseEth(s: string): bigint {
  const t = s.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") throw new Error("Enter an amount like 0.001");
  const [w, f = ""] = t.split(".");
  if (f.length > 18) throw new Error("Too many decimals");
  const v = BigInt(w || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18));
  if (v === 0n) throw new Error("Enter an amount above 0");
  return v;
}

export async function balance(address: string): Promise<bigint> {
  return toBig(await rpc("eth_getBalance", [address, "latest"]));
}

// EIP-7702 delegated EOAs have code 0xef0100…, but plain transfers to them still cost 21000+.
const isContract = (code: string | null | undefined) => Boolean(code && code !== "0x");

// Gas, fees and nonce for an EIP-1559 transaction. `data` is the token transfer call, if any.
export async function prepareFees(from: string, to: string, valueWei: bigint, data?: string) {
  const [nonceHex, block, tipHex, code] = await Promise.all([
    rpc("eth_getTransactionCount", [from, "pending"]),
    rpc("eth_getBlockByNumber", ["latest", false]),
    rpc("eth_maxPriorityFeePerGas", []).catch(() => "0x3b9aca00"),
    data ? Promise.resolve("0x1") : rpc("eth_getCode", [to, "latest"]),
  ]);
  const base = toBig(block.baseFeePerGas ?? "0x0");
  const tip = toBig(tipHex) > 0n ? toBig(tipHex) : 1_000_000_000n;
  const maxFeePerGas = base * 2n + tip;
  let gasLimit = 21000n;
  if (isContract(code)) {
    try {
      gasLimit = (toBig(await rpc("eth_estimateGas", [{ from, to, value: hex(valueWei), ...(data ? { data } : {}) }])) * 12n) / 10n;
    } catch (e) {
      if (data && /exceeds balance|insufficient|transfer amount/i.test((e as Error).message)) throw new Error("Not enough of this token in your wallet.");
      throw e;
    }
  }
  return { nonce: toBig(nonceHex), maxFeePerGas, maxPriorityFeePerGas: tip, gasLimit, maxFeeWei: gasLimit * maxFeePerGas };
}

// ERC-20 balanceOf via eth_call.
export async function tokenBalance(token: string, address: string): Promise<bigint> {
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  return toBig(await rpc("eth_call", [{ to: token, data }, "latest"]));
}

export function formatUnits(v: bigint, decimals: number, digits = decimals): string {
  const neg = v < 0n;
  const w = neg ? -v : v;
  const scale = 10n ** BigInt(decimals);
  const frac = (w % scale).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${w / scale}${frac ? "." + frac : ""}`;
}

export function parseUnits(s: string, decimals: number): bigint {
  const t = s.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") throw new Error("Enter an amount like 1.50");
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) throw new Error(`At most ${decimals} decimals`);
  const v = BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (v === 0n) throw new Error("Enter an amount above 0");
  return v;
}

export async function broadcast(raw: string): Promise<string> {
  try {
    return await rpc("eth_sendRawTransaction", [raw]);
  } catch (e) {
    // A retry through another node can report the transaction we just sent as already known.
    if (/already known|known transaction|already imported/i.test((e as Error).message)) return txHashOf(raw);
    if (/insufficient funds/i.test((e as Error).message)) throw new Error("Not enough ETH to pay the amount plus the network fee.");
    if (/nonce too low/i.test((e as Error).message)) throw new Error("Another transaction from this wallet was sent in the meantime. Review the payment again.");
    throw e;
  }
}

export async function waitReceipt(hash: string, timeoutMs = 180_000): Promise<{ status: string; blockNumber: string } | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await rpc("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 3000));
  }
  return null;
}

export interface ChainTx {
  hash: string;
  from: string;
  to: string | null;
  valueWei: bigint;
  timestamp: string | null;
  status: "ok" | "failed" | "pending";
  method: string | null;
}

// Real on-chain history (incoming and outgoing) from the public Blockscout explorer API.
export interface TokenTx {
  hash: string;
  from: string;
  to: string;
  symbol: string;
  value: bigint;
  decimals: number;
  timestamp: string | null;
}

// Stablecoin transfers in and out, including gasless ones (those are sent by Swissquote's relayer,
// so they don't show up in the wallet's own transaction list).
export async function tokenHistory(address: string): Promise<TokenTx[]> {
  const base = cachedConfig().blockscout;
  if (!base) throw new Error("no explorer API for this network");
  const res = await fetch(`${base}/api/v2/addresses/${address}/token-transfers?type=ERC-20`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
  const j = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (j.items || []).map((t: any) => ({
    hash: t.transaction_hash ?? t.tx_hash,
    from: t.from?.hash ?? "",
    to: t.to?.hash ?? "",
    symbol: t.token?.symbol ?? "?",
    value: BigInt(t.total?.value ?? "0"),
    decimals: Number(t.total?.decimals ?? t.token?.decimals ?? 18),
    timestamp: t.timestamp ?? null,
  }));
}

export async function history(address: string): Promise<ChainTx[]> {
  const base = cachedConfig().blockscout;
  if (!base) throw new Error("no explorer API for this network");
  const res = await fetch(`${base}/api/v2/addresses/${address}/transactions`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
  const j = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (j.items || []).map((t: any) => ({
    hash: t.hash,
    from: t.from?.hash ?? "",
    to: t.to?.hash ?? null,
    valueWei: BigInt(t.value ?? "0"),
    timestamp: t.timestamp ?? null,
    status: t.status === "ok" ? "ok" : t.status === "error" ? "failed" : "pending",
    method: t.method ?? null,
  }));
}
