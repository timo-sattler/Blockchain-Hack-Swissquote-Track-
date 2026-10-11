// Compliant dApp interaction. Swissquote co-signs a contract call only if it goes to an approved
// dApp, uses a function Swissquote understands, and passes a dry run on the network. Before the
// client approves, the effects are explained in plain language. Token approvals go only to
// approved dApps and never for an unlimited amount, the classic way scams drain wallets.
import { ethers } from "ethers";
import { APPROVED_DAPPS, NETWORK, provider, TOKENS } from "./chain.mjs";
import { sanctionsHit } from "./compliance.mjs";

const WETH = new ethers.Interface(["function deposit() payable", "function withdraw(uint256 wad)", "function balanceOf(address) view returns (uint256)"]);
const ERC20 = new ethers.Interface(["function approve(address spender, uint256 amount)", "function transfer(address to, uint256 amount)"]);
const UNLIMITED = 2n ** 255n; // wallets ask for 2^256 - 1; anything this large is "unlimited"

export const DAPPS = (NETWORK.dapps || []).map((d) => ({ ...d, address: ethers.getAddress(d.address) }));
const byAddress = new Map(DAPPS.map((d) => [d.address.toLowerCase(), d]));
const tokenAt = (addr) => Object.entries(TOKENS).find(([, t]) => t.address.toLowerCase() === addr.toLowerCase());

// Requests a malicious dApp could send, for the demo (refused before anything is signed).
export const DEMO_REQUESTS = NETWORK.testnet && TOKENS.USDC
  ? [
      { label: "Unknown app asks for unlimited USDC", to: TOKENS.USDC.address, data: ERC20.encodeFunctionData("approve", ["0x00000000000000000000000000000000DeaDBeef", ethers.MaxUint256]), value: "0" },
      { label: "Call an unknown contract", to: NETWORK.demoAddresses.find((d) => /contract/i.test(d.label))?.addr, data: WETH.encodeFunctionData("deposit"), value: "1000000000000000" },
    ].filter((r) => r.to)
  : [];

export function publicDapps() {
  return DAPPS.map((d) => ({
    address: d.address,
    kind: d.kind,
    name: d.name,
    title: d.title,
    actions: d.kind === "weth" ? ["wrap", "unwrap"] : [],
  }));
}

const fmt = (raw, decimals) => {
  const s = ethers.formatUnits(raw, decimals);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};
const labelOf = (addr) => APPROVED_DAPPS.get(addr.toLowerCase()) || `${addr.slice(0, 8)}…${addr.slice(-4)}`;

// Explains what a contract call from `from` would do. `ethWei` is the ETH moved (for limits and
// the high-value check); `allowed` is false with plain-language reasons when Swissquote refuses.
export async function explainCall(from, { to, value, data }) {
  const reasons = [];
  const effects = [];
  const checks = [];
  let ethWei = value;
  let call = null;
  const dapp = byAddress.get(to.toLowerCase());
  const token = tokenAt(to);

  if (dapp?.kind === "weth") {
    try {
      call = WETH.parseTransaction({ data, value });
    } catch {
      call = null;
    }
    if (!call || !["deposit", "withdraw"].includes(call.name)) reasons.push(`${dapp.name}: only wrapping and unwrapping are approved.`);
    else if (call.name === "deposit") {
      if (value <= 0n) reasons.push("Enter an amount above 0.");
      effects.push({ dir: "out", text: `${fmt(value, 18)} ETH leaves your wallet` }, { dir: "in", text: `${fmt(value, 18)} WETH arrives in your wallet (1 WETH = 1 ETH)` });
    } else {
      const wad = call.args[0];
      if (value !== 0n) reasons.push("Unwrapping sends no ETH.");
      if (wad <= 0n) reasons.push("Enter an amount above 0.");
      const have = await new ethers.Contract(to, WETH, provider).balanceOf(from);
      if (have < wad) reasons.push(`You only have ${fmt(have, 18)} WETH.`);
      ethWei = wad;
      effects.push({ dir: "out", text: `${fmt(wad, 18)} WETH leaves your wallet` }, { dir: "in", text: `${fmt(wad, 18)} ETH arrives in your wallet` });
    }
  } else if (token) {
    const [sym, t] = token;
    try {
      call = ERC20.parseTransaction({ data, value });
    } catch {
      call = null;
    }
    if (call?.name === "transfer") reasons.push(`To send ${sym}, use Send: it screens the recipient and can pay the fee for you.`);
    else if (call?.name !== "approve") reasons.push(`${sym}: only limited approvals to approved dApps are allowed.`);
    else {
      const [spender, amount] = call.args;
      const hit = sanctionsHit(spender);
      if (hit) reasons.push(`The app asking for access is on a sanctions list (${hit}).`);
      else if (byAddress.get(spender.toLowerCase())?.kind !== "spender") reasons.push(`${labelOf(spender)} is not on Swissquote's approved dApp list. Apps you don't know are the most common way wallets get drained.`);
      if (amount >= UNLIMITED) reasons.push(`It asks for unlimited access to your ${sym}: it could take all of it, now or later. Swissquote only co-signs approvals for an exact amount.`);
      effects.push({ dir: "allow", text: amount >= UNLIMITED ? `${labelOf(spender)} could take ALL your ${sym}, at any time` : `${labelOf(spender)} may take up to ${fmt(amount, t.decimals)} ${sym} from your wallet later` });
    }
    if (value !== 0n) reasons.push("A token approval sends no ETH.");
  } else {
    const code = await provider.getCode(to).catch(() => "0x");
    if (!code || code === "0x") reasons.push("This address is not an app. To pay someone, use Send.");
    else reasons.push(`${labelOf(to)} is not on Swissquote's approved dApp list. Swissquote only co-signs calls to apps it has reviewed.`);
  }

  if (sanctionsHit(to)) reasons.push(`This contract is on a sanctions list (${sanctionsHit(to)}).`);
  if (dapp) checks.push({ ok: true, text: `Approved dApp: ${labelOf(to)}` });
  if (token) checks.push({ ok: true, text: `Known token: ${labelOf(to)}` });
  if (call) checks.push({ ok: !reasons.length, text: `Request: ${call.name}(${call.fragment.inputs.map((i) => i.name || i.type).join(", ")})${reasons.length ? " is not allowed" : ""}` });

  // Dry run on the real network. eth_call skips the balance check, so ETH is checked separately.
  if (!reasons.length) {
    const balance = await provider.getBalance(from);
    if (balance < value) reasons.push(`You only have ${fmt(balance, 18)} ETH.`);
    else {
      try {
        await provider.call({ from, to, value, data });
        checks.push({ ok: true, text: `Dry run on ${NETWORK.name} succeeded` });
      } catch (e) {
        reasons.push(`The dry run on ${NETWORK.name} failed: ${e.shortMessage || e.reason || "the contract refused it"}. Signing it would only waste the fee.`);
        checks.push({ ok: false, text: `Dry run on ${NETWORK.name} failed` });
      }
    }
  }
  return { allowed: reasons.length === 0, reasons, effects, checks, ethWei, call: call?.name || null, dapp: dapp ? labelOf(to) : token ? token[0] : null };
}
