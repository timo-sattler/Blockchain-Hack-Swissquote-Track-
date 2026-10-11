// MOCK compliance provider: sanctions screening, counterparty classification, Travel Rule
// classification and risk tiering. In production: Chainalysis/Elliptic/TRM + a Travel Rule
// network (e.g. Notabene / TRP) behind the same interface.
import { ethers } from "ethers";
import { provider, treasury, APPROVED_DAPPS, NETWORK, TOKENS } from "./chain.mjs";
import { getDb } from "./store.mjs";
import { ethChf } from "./price.mjs";

export const HIGH_VALUE_CHF = Number(process.env.HIGH_VALUE_CHF || (NETWORK.testnet ? 20 : 1000)); // demo threshold on testnet
export const DAILY_LIMIT_CHF = Number(process.env.DAILY_LIMIT_CHF || 5000);

// Small sample sanctions list (MOCK). Real screening would call a provider with the full
// OFAC / SECO / EU lists.
const SANCTIONED = new Map(
  [
    ["0x098B716B8Aaf21512996dC57EB0615e2383E2f96", "OFAC SDN: Lazarus Group (Ronin bridge exploit)"],
    ["0x8589427373D6D84E98730D7795D8f6f8731FDA16", "Tornado Cash (historic OFAC listing, kept as sample)"],
    ["0x000000000000000000000000000000000000bAd1", "DEMO: listed scam address"],
  ].map(([a, why]) => [a.toLowerCase(), why])
);

export function sanctionsHit(address) {
  return SANCTIONED.get(String(address).toLowerCase()) || null;
}

export const toChf = (eth) => Math.round(eth * ethChf() * 100) / 100;

// Amount in the asset's smallest unit (wei, or 6-decimal token units) -> { units, chf }.
export function valueOf(asset, raw) {
  const amount = BigInt(raw);
  if (asset === "ETH") {
    const eth = Number(ethers.formatEther(amount));
    return { units: eth, chf: toChf(eth) };
  }
  const t = TOKENS[asset];
  if (!t) throw new Error(`Unsupported asset ${asset}`);
  const units = Number(ethers.formatUnits(amount, t.decimals));
  return { units, chf: Math.round(units * t.chf * 100) / 100 };
}

// `asset` is ETH, USDC or EURC; `raw` the amount in its smallest unit. `to` is always the person
// receiving the funds (for a token transfer: the recipient inside the call, not the token contract).
export async function screen(client, to, raw, asset = "ETH") {
  const reasons = [];
  if (!ethers.isAddress(to)) return { decision: "blocked", reasons: ["Not a valid Ethereum address."] };
  let value;
  try {
    if (BigInt(raw) < 0n) throw new Error("negative");
    value = valueOf(asset, raw);
  } catch {
    return { decision: "blocked", reasons: ["Not a valid amount."] };
  }
  const toL = to.toLowerCase();
  const eth = asset === "ETH" ? value.units : 0;
  const chf = value.chf;
  const tier = chf >= HIGH_VALUE_CHF ? "high-value" : "standard";

  let counterparty = { type: "unknown-self-hosted", label: "External self-hosted wallet (not a Swissquote client)" };
  let travelRule =
    "You are paying a third party from your own self-custody wallet. You sign with your own key, so Swissquote is not the sending institution and no Travel Rule message is sent. If the recipient is a crypto exchange, it will run its own checks.";
  let decision = "ok";

  const hit = sanctionsHit(to);
  if (hit) {
    return {
      decision: "blocked",
      tier,
      chf,
      eth,
      reasons: [`Recipient is on a sanctions list (${hit}). Swissquote will not help you send this transaction.`],
      counterparty: { type: "sanctioned", label: hit },
      travelRule: "Blocked before signing.",
      ethChf: ethChf(),
      highValueChf: HIGH_VALUE_CHF,
    };
  }

  if (client.wallet && toL === client.wallet.address.toLowerCase()) {
    counterparty = { type: "self", label: "This is your own wallet" };
  } else if (toL === treasury.address.toLowerCase()) {
    counterparty = { type: "swissquote-account", label: `Your Swissquote account ${client.id} (deposit)` };
    travelRule = "Deposit to Swissquote from a wallet Swissquote has already verified as yours. Proof of ownership is on file, so no extra checks are needed.";
  } else {
    const other = Object.values(getDb().clients).find((c) => c.wallet && c.wallet.address.toLowerCase() === toL);
    if (other) {
      const [first, last] = other.name.split(" ");
      counterparty = { type: "swissquote-wallet", label: `Swissquote Wallet of ${first} ${last?.[0] || ""}. (verified client)` };
      travelRule = "Both wallets have verified Swissquote owners, so sender and recipient are known. No external Travel Rule message is needed.";
    } else {
      const code = await provider.getCode(to).catch(() => "0x");
      // EIP-7702 delegated EOAs carry a 0xef0100 designator; they are still people's wallets.
      if (code && code !== "0x" && !code.startsWith("0xef0100")) {
        const dapp = APPROVED_DAPPS.get(toL);
        if (dapp) counterparty = { type: "approved-dapp", label: dapp };
        else {
          counterparty = { type: "unknown-contract", label: "Unknown smart contract" };
          decision = "review";
          reasons.push("This address is a smart contract that is not on Swissquote's approved dApp list. Funds sent to unknown contracts are often lost or stolen.");
        }
      }
    }
  }

  if (tier === "high-value") reasons.push(`Amount ≥ CHF ${HIGH_VALUE_CHF}: needs a bank-verified passkey check and an SMS code.`);
  const usedToday = getDb()
    .activity.filter((a) => a.clientId === client.id && a.type === "wallet-tx" && Date.now() - Date.parse(a.at) < 86_400_000)
    .reduce((s, a) => s + (a.chf || 0), 0);
  if (usedToday + chf > DAILY_LIMIT_CHF) {
    decision = "blocked";
    reasons.push(`Daily limit of CHF ${DAILY_LIMIT_CHF} exceeded (already CHF ${usedToday.toFixed(2)} today).`);
  }

  return { decision, tier, chf, eth, asset, units: value.units, reasons, counterparty, travelRule, ethChf: ethChf(), highValueChf: HIGH_VALUE_CHF };
}
