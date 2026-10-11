// ETH/CHF reference price. Live from CoinGecko (no API key needed), refreshed every 5 minutes,
// falling back to MOCK_ETH_CHF when the feed is unreachable or PRICE_FEED=off.
const FALLBACK = Number(process.env.MOCK_ETH_CHF || 2900);
const LIVE = process.env.PRICE_FEED !== "off";
const REFRESH_MS = 5 * 60_000;

let current = { chf: FALLBACK, source: "fixed (MOCK_ETH_CHF)", at: null };

async function refresh() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=chf", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const chf = Number((await r.json())?.ethereum?.chf);
    if (!(chf > 0)) throw new Error("no price in response");
    current = { chf, source: "CoinGecko", at: new Date().toISOString() };
  } catch (e) {
    if (!current.at) console.warn(`[bank] live ETH/CHF price unavailable (${e.message}); using ${current.chf}`);
  }
}

if (LIVE) {
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
}

export const ethChf = () => current.chf;
export const priceInfo = () => ({ ...current });
