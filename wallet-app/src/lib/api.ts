// Clients for the MOCK bank backend (/api, proxied to :4000) and the MOCK Share Vault
// (/vault, proxied to :4100 — a separate process with its own storage, MPC party B).
let token: string | null = sessionStorage.getItem("sq.token");

// Fired when the bank rejects our session (idle timeout, server restart, revoked device).
export const SESSION_EXPIRED = "sq:session-expired";

export function setToken(t: string | null) {
  token = t;
  if (t) sessionStorage.setItem("sq.token", t);
  else sessionStorage.removeItem("sq.token");
}
export const hasToken = () => Boolean(token);

async function call<T>(base: string, path: string, method = "GET", body?: unknown, auth = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error("Swissquote can't be reached right now. Check your connection."), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth && token && !path.startsWith("/auth/")) {
      setToken(null);
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    }
    const fallback = res.status >= 500 ? `Swissquote is temporarily unavailable (HTTP ${res.status}).` : `HTTP ${res.status}`;
    throw Object.assign(new Error(data.error || fallback), { status: res.status });
  }
  return data as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bank = <T = any>(path: string, method = "GET", body?: unknown) => call<T>("/api", path, method, body);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vault = <T = any>(path: string, method = "GET", body?: unknown) => call<T>("/vault", path, method, body, false);

export interface MockDelivery {
  channel: string;
  to?: string;
  code?: string;
}

export interface ClientView {
  id: string;
  name: string;
  phoneMasked: string;
  emailMasked: string;
  accounts: { chf: number; ethCustody: number };
  wallet: null | { address: string; activatedAt: string | null; backupMode?: "bank" | "client-file"; custody?: string; travelRule: { status: string; method: string; verifiedAt: string } };
  hasKycPhoto: boolean;
  hasBackupA: boolean;
  credentials: { id: string; deviceLabel: string; revoked: boolean }[];
}

export interface PublicConfig {
  chainId: number;
  rpcUrls: string[];
  explorer: string;
  blockscout: string;
  network: { key: string; name: string; testnet: boolean; symbol: string; faucets: string[] };
  demoAddresses: { label: string; addr: string }[];
  treasuryAddress: string;
  treasuryTopup: boolean;
  highValueChf: number;
  ethChf: number;
  price?: { source: string; at: string | null };
  recoveryDelaySeconds: number;
  tokens: Record<string, { address: string; decimals: number; name: string; version: string; chf: number }>;
  tokenFaucet: string | null;
  gasless: { available: boolean; dailyLimit: number };
  dapps: { address: string; kind: "weth" | "spender"; name: string; title: string; actions: string[] }[];
  demoDappRequests: { label: string; to: string; data: string; value: string }[];
}

// Used when the bank was never reached from this device (self-custody mode still needs a chain).
const DEFAULT_CONFIG: PublicConfig = {
  chainId: 11155111,
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"],
  explorer: "https://sepolia.etherscan.io",
  blockscout: "https://eth-sepolia.blockscout.com",
  network: { key: "sepolia", name: "Sepolia testnet", testnet: true, symbol: "ETH", faucets: [] },
  demoAddresses: [],
  treasuryAddress: "",
  treasuryTopup: false,
  highValueChf: 20,
  ethChf: 2900,
  recoveryDelaySeconds: 90,
  tokens: {},
  tokenFaucet: null,
  gasless: { available: false, dailyLimit: 0 },
  dapps: [],
  demoDappRequests: [],
};

const CONFIG_KEY = "sq.config.v2";
let cfg: PublicConfig | null = null;
let cfgAt = 0;

// Tolerates older bank servers that don't send every field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(raw: any): PublicConfig {
  const rpcUrls = Array.isArray(raw?.rpcUrls) && raw.rpcUrls.length ? raw.rpcUrls : raw?.rpcUrl ? [raw.rpcUrl, ...DEFAULT_CONFIG.rpcUrls] : DEFAULT_CONFIG.rpcUrls;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    rpcUrls,
    network: { ...DEFAULT_CONFIG.network, ...(raw?.network || {}) },
    demoAddresses: Array.isArray(raw?.demoAddresses) ? raw.demoAddresses : [],
    dapps: Array.isArray(raw?.dapps) ? raw.dapps : [],
    demoDappRequests: Array.isArray(raw?.demoDappRequests) ? raw.demoDappRequests : [],
    treasuryTopup: raw?.treasuryTopup ?? Boolean(raw?.treasuryAddress),
  };
}

export function cachedConfig(): PublicConfig {
  if (cfg) return cfg;
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
    if (stored?.chainId) return (cfg = normalize(stored));
  } catch {
    /* ignore */
  }
  return DEFAULT_CONFIG;
}

// The bank's config (network, price, thresholds), refreshed at most every 5 minutes. Falls back to
// the last copy seen, so the wallet keeps working while Swissquote is offline.
export async function config(): Promise<PublicConfig> {
  if (cfg && Date.now() - cfgAt < 5 * 60_000) return cfg;
  try {
    cfg = normalize(await call<PublicConfig>("/api", "/public/config", "GET", undefined, false));
    cfgAt = Date.now();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  } catch {
    return cachedConfig();
  }
}
