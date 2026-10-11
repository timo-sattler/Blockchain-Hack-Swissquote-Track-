import { useEffect, useState } from "react";
import { bank, cachedConfig, config, type ClientView, type MockDelivery, type PublicConfig } from "../lib/api";
import type { KeySource } from "../lib/envelope";
import { balance, formatEth, formatUnits, parseUnits, prepareFees, tokenBalance, waitReceipt } from "../lib/eth";
import { checkPartA, keySourceFor, passkeySource, wipeSource } from "../lib/keys";
import { authName, getPasskey, requirePrf } from "../lib/passkey";
import { approveAndSend, draftPayment, prepareWithBank, signOffline, type Asset, type Draft, type Sent } from "../lib/pay";
import { keyModeOf, type Profile } from "../lib/profile";
import { isValidEthAddress } from "../lib/walletcore";
import { Banner, Btn, MockSms, PasswordField, Top, short, useAsync } from "../ui";

interface Screening {
  decision: "ok" | "review" | "blocked";
  tier: "standard" | "high-value";
  chf: number;
  reasons: string[];
  counterparty: { type: string; label: string };
  travelRule: string;
  highValueChf: number;
}
type Phase = "form" | "review" | "otp" | "sending" | "done";

const decimalsOf = (cfg: PublicConfig, asset: Asset) => (asset === "ETH" ? 18 : cfg.tokens[asset]?.decimals ?? 6);

export function Send({ profile, client, onBack }: { profile: Profile; client: ClientView | null; onBack: () => void }) {
  const [cfg, setCfg] = useState<PublicConfig>(cachedConfig());
  const [asset, setAsset] = useState<Asset>("ETH");
  const [gasless, setGasless] = useState(true);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(cachedConfig().network.testnet ? "0.0005" : "");
  const [phase, setPhase] = useState<Phase>("form");
  const [screening, setScreening] = useState<Screening | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ack, setAck] = useState(false);
  const [approval, setApproval] = useState<{ response: unknown; delivery: MockDelivery | null; src: KeySource } | null>(null);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [cardWords, setCardWords] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [status, setStatus] = useState<string>("");
  const { busy, error, run, setError } = useAsync();
  const mode = keyModeOf(profile);
  const bio = authName();
  const recipient = to.trim();
  const tokens = Object.keys(cfg.tokens) as Asset[];
  const sponsored = asset !== "ETH" && gasless && Boolean(client) && cfg.gasless.available;
  const offline = !client;

  useEffect(() => {
    config().then(setCfg);
  }, []);

  const pickAsset = (a: Asset) => {
    setAsset(a);
    setAmount(a === "ETH" ? (cfg.network.testnet ? "0.0005" : "") : "1");
  };

  const useMax = () =>
    run(async () => {
      if (asset !== "ETH") {
        const bal = await tokenBalance(cfg.tokens[asset].address, profile.address);
        if (bal === 0n) throw new Error(`You have no ${asset} yet.`);
        setAmount(formatUnits(bal, decimalsOf(cfg, asset)));
        return;
      }
      const target = (await isValidEthAddress(recipient)) ? recipient : profile.address;
      const [f, bal] = await Promise.all([prepareFees(profile.address, target, 0n), balance(profile.address)]);
      const max = bal - f.maxFeeWei;
      if (max <= 0n) throw new Error(`Your balance (${formatEth(bal)} ETH) doesn't cover the network fee.`);
      setAmount(formatEth(max, 18));
    });

  const review = () =>
    run(async () => {
      if (!(await isValidEthAddress(recipient))) throw new Error("That's not a valid Ethereum address");
      if (recipient.toLowerCase() === profile.address.toLowerCase()) throw new Error("That's your own wallet address.");
      const value = parseUnits(amount, decimalsOf(cfg, asset));
      const verdict = client ? await bank<Screening>("/compliance/screen", "POST", { to: recipient, asset, amount: value.toString() }) : null;
      if (verdict?.decision === "blocked") {
        setScreening(verdict);
        setDraft(null);
        setPhase("review");
        return;
      }
      if (sponsored) {
        const relay = await bank<{ funded: boolean; remaining: number; message: string }>("/relay/status");
        if (!relay.funded) throw new Error(`${relay.message} Untick "Swissquote pays the network fee".`);
        if (relay.remaining === 0) throw new Error(`You used today's free transfers. Untick "Swissquote pays the network fee" to pay it yourself.`);
      }
      const d = await draftPayment(profile, cfg, asset, recipient, value, sponsored);
      const eth = await balance(profile.address);
      if (asset === "ETH" && eth < value + d.maxFeeWei!) {
        throw new Error(
          `Not enough ETH. You have ${formatEth(eth)} ETH; this needs up to ${formatEth(value + d.maxFeeWei!)} ETH including the network fee.${cfg.treasuryTopup ? " Top up from your Swissquote account first." : ""}`
        );
      }
      if (asset !== "ETH") {
        const bal = await tokenBalance(cfg.tokens[asset].address, profile.address);
        if (bal < value) throw new Error(`Not enough ${asset}. You have ${formatUnits(bal, decimalsOf(cfg, asset))} ${asset}.`);
        if (!d.gasless && eth < d.maxFeeWei!) throw new Error(`The network fee needs up to ${formatEth(d.maxFeeWei!)} ETH, and you have ${formatEth(eth)} ETH.${cfg.gasless.available ? " Let Swissquote pay it instead." : ""}`);
      }
      setDraft(d);
      setScreening(verdict);
      setAck(false);
      setPhase("review");
    });

  async function finish(response: unknown, src: KeySource, otpCode: string | undefined, tier: string) {
    setPhase("sending");
    const r = await approveAndSend(profile, draft!, { response, otp: otpCode }, src, setStatus, tier);
    await done(r);
  }

  async function done(r: Sent) {
    setSent(r);
    setPhase("done");
    setPassword("");
    setCardWords("");
    setStatus("Waiting for confirmation…");
    const rcpt = await waitReceipt(r.hash);
    setStatus(rcpt ? (rcpt.status === "0x1" ? `Confirmed in block ${parseInt(rcpt.blockNumber, 16)}` : "Transaction failed on-chain") : "Still pending. Check the explorer.");
  }

  const confirm = () =>
    run(async () => {
      // Check the wallet password before any bank step, so a typo doesn't burn an SMS code.
      const pwSrc = mode === "password" ? await keySourceFor(profile, password) : null;
      if (pwSrc) await checkPartA(profile, pwSrc);
      if (offline) {
        setPhase("sending");
        await done(await signOffline(profile, draft!, pwSrc ?? (await passkeySource(profile.credentialId)), cardWords, setStatus));
        return;
      }
      // One biometric prompt: the bank-verified approval of this exact payment, and (passkey mode)
      // the PRF secret that decrypts Part A on this device.
      const prepared = await prepareWithBank(draft!);
      const pk = await getPasskey({ serverOptions: prepared.options });
      const src = pwSrc ?? { kind: "prf" as const, prf: requirePrf(pk) };
      if (prepared.otpRequired) {
        setApproval({ response: pk.json, delivery: prepared.mockDelivery, src });
        setOtp("");
        setPhase("otp");
        return;
      }
      await finish(pk.json, src, undefined, "standard");
    });

  const confirmOtp = () =>
    run(async () => {
      const a = approval!;
      setApproval(null);
      await finish(a.response, a.src, otp, "high-value");
    });

  useEffect(() => {
    if (error && phase === "sending") setPhase("review");
  }, [error, phase]);

  const backToForm = () => {
    if (approval) wipeSource(approval.src);
    setApproval(null);
    setError(null);
    setPhase("form");
  };

  const quick = [cfg.treasuryAddress && asset === "ETH" && { label: "My Swissquote account", addr: cfg.treasuryAddress }, ...(cfg.demoAddresses || [])].filter(Boolean) as {
    label: string;
    addr: string;
  }[];
  const chfOf = (v: string) => {
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) return "–";
    return (n * (asset === "ETH" ? cfg.ethChf : cfg.tokens[asset]?.chf ?? 1)).toFixed(2);
  };
  const security = offline
    ? `${mode === "password" ? "Wallet password" : bio} + your Recovery Card (Part A + Part C on this device)`
    : `${screening?.tier === "high-value" ? `${bio} + SMS code` : mode === "password" ? `Wallet password + ${bio}` : bio}, then Swissquote co-signs (Part A + Part B)`;
  const wordCount = cardWords.trim() ? cardWords.trim().split(/\s+/).length : 0;

  return (
    <>
      <Top title={`Send ${asset}`} onBack={phase === "sending" ? undefined : onBack} />
      <div className="content">
        {phase === "form" && (
          <>
            {tokens.length > 0 && (
              <div className="row wrap">
                {(["ETH", ...tokens] as Asset[]).map((a) => (
                  <button key={a} className={`badge chip ${asset === a ? "on" : ""}`} onClick={() => pickAsset(a)} aria-pressed={asset === a}>
                    {asset === a ? "◉" : "○"} {a}
                  </button>
                ))}
              </div>
            )}
            <label className="f">To (Ethereum address)</label>
            <input className="f mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            {quick.length > 0 && (
              <div className="row wrap">
                {quick.map((q) => (
                  <button key={q.addr} className="badge chip" onClick={() => setTo(q.addr)}>
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            <label className="f">Amount ({asset})</label>
            <div className="row">
              <input className="f" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" style={{ flex: 1 }} />
              <div style={{ width: 90 }}>
                <Btn kind="secondary" onClick={useMax} busy={busy}>
                  Max
                </Btn>
              </div>
            </div>
            <p className="muted small">
              ≈ CHF {chfOf(amount || "0")} · Payments of CHF {cfg.highValueChf} or more need an SMS code too{cfg.network.testnet ? " (demo threshold)" : ""}.
            </p>
            {asset !== "ETH" && cfg.gasless.available && !offline && (
              <label className="check">
                <input type="checkbox" checked={gasless} onChange={(e) => setGasless(e.target.checked)} />
                Swissquote pays the network fee (free, up to {cfg.gasless.dailyLimit} transfers a day)
              </label>
            )}
            {!cfg.network.testnet && <Banner kind="warn">Ethereum mainnet: you are sending real funds. Double-check the address.</Banner>}
            <Btn onClick={review} busy={busy} disabled={!to || !amount}>
              Review payment
            </Btn>
          </>
        )}

        {phase === "review" && (
          <>
            {draft && (
              <div className="card">
                <h3>You're about to send</h3>
                <div className="kv">
                  <span className="k">Amount</span>
                  <span>
                    <b>
                      {amount} {asset}
                    </b>{" "}
                    {screening && <>≈ CHF {screening.chf}</>}
                  </span>
                  <span className="k">To</span>
                  <span>
                    <span className="mono">{short(recipient)}</span>
                    <br />
                    {screening?.counterparty.label}
                  </span>
                  <span className="k">Network fee</span>
                  <span>{draft.gasless ? <span className="badge ok">Paid by Swissquote</span> : `max ${formatEth(draft.maxFeeWei!, 8)} ETH`}</span>
                  <span className="k">Network</span>
                  <span>{cfg.network.name}</span>
                  <span className="k">Security</span>
                  <span>{security}</span>
                </div>
              </div>
            )}
            {screening && (
              <>
                {screening.decision === "blocked" && <Banner kind="bad">⛔ {screening.reasons.join(" ")} Swissquote will not co-sign this payment.</Banner>}
                {screening.decision === "review" && <Banner kind="warn">⚠️ {screening.reasons.filter((r) => !r.startsWith("Amount")).join(" ")}</Banner>}
                {screening.decision === "ok" && <Banner kind="ok">✓ Recipient screened: not on sanctions lists.</Banner>}
                {screening.decision !== "blocked" && (
                  <Banner kind="info">
                    <b>Travel Rule:</b> {screening.travelRule}
                  </Banner>
                )}
              </>
            )}
            {offline && (
              <>
                <Banner kind="warn">
                  Swissquote is offline, so this recipient was not screened and Swissquote can't co-sign. Your device signs with Part A and Part C: enter the 24
                  words of your Recovery Card.
                </Banner>
                <label className="f">Recovery Card words {wordCount > 0 && <span className="muted">· {wordCount}/24</span>}</label>
                <textarea className="f" value={cardWords} onChange={(e) => setCardWords(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </>
            )}
            {screening?.decision === "review" && (
              <label className="check">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand the risk and want to send anyway.
              </label>
            )}
            {mode === "password" && draft && <PasswordField label="Wallet password" value={password} onChange={setPassword} autoFocus />}
            {draft && (
              <Btn
                onClick={confirm}
                busy={busy}
                disabled={(screening?.decision === "review" && !ack) || (mode === "password" && !password) || (offline && wordCount !== 24)}
              >
                {offline ? "Sign on this device and send" : screening?.tier === "high-value" ? `Approve with ${bio} + SMS` : `Approve with ${bio}`}
              </Btn>
            )}
            <Btn kind="secondary" onClick={backToForm}>
              Edit
            </Btn>
          </>
        )}

        {phase === "otp" && (
          <>
            <Banner kind="info">✓ {bio} approved this exact payment: the bank verified your passkey signature over the amount, recipient and transaction. Now enter the SMS code.</Banner>
            <MockSms delivery={approval?.delivery} />
            <input
              className="f"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && confirmOtp()}
            />
            <Btn onClick={confirmOtp} busy={busy} disabled={otp.length !== 6}>
              Co-sign &amp; send
            </Btn>
            <Btn kind="secondary" onClick={backToForm}>
              Cancel
            </Btn>
          </>
        )}

        {(phase === "sending" || phase === "done") && (
          <div className="card center">
            <div className="big-ico">{phase === "done" ? "🚀" : "⏳"}</div>
            <h3>{phase === "done" ? `Sent to ${cfg.network.name}` : "Sending…"}</h3>
            <p className="muted">{status}</p>
            {sent && (
              <>
                {sent.sponsored && <p className="small">Swissquote paid the network fee.</p>}
                <p className="mono small">{sent.hash}</p>
                <a href={`${cfg.explorer}/tx/${sent.hash}`} target="_blank" rel="noreferrer">
                  View on the explorer
                </a>
              </>
            )}
            {phase === "done" && (
              <div style={{ marginTop: 14 }}>
                <Btn onClick={onBack}>Done</Btn>
              </div>
            )}
          </div>
        )}
        {error && <div className="err">{error}</div>}
      </div>
    </>
  );
}
