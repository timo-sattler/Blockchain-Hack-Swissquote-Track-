import { useEffect, useState } from "react";
import { bank, cachedConfig, config, type ClientView, type MockDelivery, type PublicConfig } from "../lib/api";
import type { KeySource } from "../lib/envelope";
import { balance, formatEth, parseUnits, tokenBalance, waitReceipt } from "../lib/eth";
import { checkPartA, keySourceFor, wipeSource } from "../lib/keys";
import { authName, getPasskey, requirePrf } from "../lib/passkey";
import { approveAndSend, draftContractCall, prepareWithBank, type Draft, type Sent } from "../lib/pay";
import { keyModeOf, type Profile } from "../lib/profile";
import { encodeCall } from "../lib/walletcore";
import { Banner, Btn, MockSms, PasswordField, Segments, Top, useAsync } from "../ui";

// Swissquote's answer to "DeFi without scams": the wallet calls approved dApps only. Swissquote
// explains each request in plain language after a dry run on the network, refuses unknown apps
// and unlimited token approvals, and co-signs like any payment (Face ID, SMS above the threshold).
interface Simulation {
  decision: "ok" | "blocked";
  reasons: string[];
  effects: { dir: "out" | "in" | "allow"; text: string }[];
  checks: { ok: boolean; text: string }[];
  dapp: string | null;
  tier: "standard" | "high-value";
  chf: number;
  highValueChf: number;
}
interface Request {
  title: string;
  to: string;
  data: string;
  value: bigint;
}
type Phase = "pick" | "review" | "otp" | "sending" | "done";
type Action = "Wrap" | "Unwrap";

export function Apps({ profile, client, onBack }: { profile: Profile; client: ClientView | null; onBack: () => void }) {
  const [cfg, setCfg] = useState<PublicConfig>(cachedConfig());
  const [action, setAction] = useState<Action>("Wrap");
  const [amount, setAmount] = useState("0.0005");
  const [bal, setBal] = useState<{ eth: bigint; weth: bigint } | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [request, setRequest] = useState<Request | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [approval, setApproval] = useState<{ response: unknown; delivery: MockDelivery | null; src: KeySource } | null>(null);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [status, setStatus] = useState("");
  const { busy, error, run, setError } = useAsync();
  const mode = keyModeOf(profile);
  const bio = authName();
  const weth = cfg.dapps.find((d) => d.kind === "weth");

  useEffect(() => {
    config().then(setCfg);
  }, []);

  useEffect(() => {
    if (!weth || phase !== "pick") return;
    Promise.all([balance(profile.address), tokenBalance(weth.address, profile.address)])
      .then(([eth, w]) => setBal({ eth, weth: w }))
      .catch(() => {});
  }, [weth?.address, profile.address, phase]);

  // Swissquote explains and dry-runs the request; only then is a transaction built.
  const review = (r: Request) =>
    run(async () => {
      const s = await bank<Simulation>("/dapps/simulate", "POST", { to: r.to, data: r.data, value: r.value.toString() });
      setRequest(r);
      setSim(s);
      setDraft(null);
      if (s.decision === "ok") {
        const d = await draftContractCall(profile, cfg, r.to, r.data, r.value);
        const eth = await balance(profile.address);
        if (eth < r.value + d.maxFeeWei!) throw new Error(`Not enough ETH for this and the network fee (up to ${formatEth(r.value + d.maxFeeWei!)} ETH; you have ${formatEth(eth)} ETH).`);
        setDraft(d);
      }
      setPhase("review");
    });

  const reviewWeth = async () => {
    if (!weth) return;
    const value = parseUnits(amount, 18);
    if (action === "Wrap") review({ title: `Wrap ${amount} ETH`, to: weth.address, data: await encodeCall("deposit"), value });
    else review({ title: `Unwrap ${amount} WETH`, to: weth.address, data: await encodeCall("withdraw", { amount: value }), value: 0n });
  };

  async function finish(response: unknown, src: KeySource, otpCode: string | undefined, tier: string) {
    setPhase("sending");
    const r = await approveAndSend(profile, draft!, { response, otp: otpCode }, src, setStatus, tier);
    setSent(r);
    setPhase("done");
    setPassword("");
    setStatus("Waiting for confirmation…");
    const rcpt = await waitReceipt(r.hash);
    setStatus(rcpt ? (rcpt.status === "0x1" ? `Confirmed in block ${parseInt(rcpt.blockNumber, 16)}` : "Transaction failed on-chain") : "Still pending. Check the explorer.");
  }

  const confirm = () =>
    run(async () => {
      const pwSrc = mode === "password" ? await keySourceFor(profile, password) : null;
      if (pwSrc) await checkPartA(profile, pwSrc);
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

  const back = () => {
    if (approval) wipeSource(approval.src);
    setApproval(null);
    setError(null);
    setSim(null);
    setDraft(null);
    setPhase("pick");
  };

  const arrow = { out: "−", in: "+", allow: "!" } as const;

  return (
    <>
      <Top title={phase === "pick" ? "Apps" : request?.title || "Apps"} onBack={phase === "sending" ? undefined : phase === "pick" ? onBack : back} />
      <div className="content">
        {!client && <Banner kind="warn">Apps need Swissquote's checks, and Swissquote is offline right now. Plain payments still work from Send.</Banner>}

        {phase === "pick" && client && (
          <>
            <p className="muted">Use DeFi apps that Swissquote has reviewed. Before you approve, Swissquote tests every request on the network and tells you what it will do.</p>
            {weth && (
              <div className="card stack">
                <div className="row between">
                  <h3 style={{ margin: 0 }}>{weth.title}</h3>
                  <span className="badge ok">✓ Approved</span>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  Turns ETH into WETH, the token form of ETH that DeFi apps such as Uniswap use. 1 WETH is always worth 1 ETH, and you can unwrap at any
                  time.
                </p>
                {bal && (
                  <p className="small" style={{ margin: 0 }}>
                    You have <b>{formatEth(bal.eth)} ETH</b> and <b>{formatEth(bal.weth)} WETH</b>
                  </p>
                )}
                <Segments<Action> items={["Wrap", "Unwrap"]} active={action} onChange={setAction} />
                <label className="f">Amount ({action === "Wrap" ? "ETH" : "WETH"})</label>
                <input className="f" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                <Btn onClick={reviewWeth} busy={busy} disabled={!amount}>
                  Check with Swissquote
                </Btn>
              </div>
            )}

            <div className="card">
              <h3>What Swissquote checks</h3>
              <div className="kv">
                <span className="k">✓</span>
                <span>The app is on Swissquote's approved list and not sanctioned</span>
                <span className="k">✓</span>
                <span>Swissquote understands the request (no hidden actions)</span>
                <span className="k">✓</span>
                <span>A dry run on {cfg.network.name} succeeds, so you don't pay for a failure</span>
                <span className="k">✓</span>
                <span>Token approvals: approved apps only, never unlimited</span>
                <span className="k">✓</span>
                <span>From CHF {cfg.highValueChf}: {bio} plus an SMS code</span>
              </div>
            </div>

            {cfg.demoDappRequests.length > 0 && (
              <div className="card stack">
                <h3 style={{ margin: 0 }}>Try a risky request (demo)</h3>
                <p className="muted small" style={{ margin: 0 }}>
                  What a scam site would ask your wallet to sign. Swissquote refuses before anything is signed.
                </p>
                {cfg.demoDappRequests.map((r) => (
                  <Btn key={r.label} kind="secondary" busy={busy} onClick={() => review({ title: r.label, to: r.to, data: r.data, value: BigInt(r.value) })}>
                    {r.label}
                  </Btn>
                ))}
              </div>
            )}
          </>
        )}

        {phase === "review" && sim && (
          <>
            <div className="card">
              <h3>What will happen</h3>
              {sim.effects.length === 0 && <p className="muted small">Swissquote can't say what this request does.</p>}
              {sim.effects.map((e) => (
                <div className="effect" key={e.text}>
                  <span className={`pill ${e.dir === "in" ? "up" : e.dir === "out" ? "down" : "warn"}`}>{arrow[e.dir]}</span>
                  <span>{e.text}</span>
                </div>
              ))}
              {draft && (
                <p className="muted small">
                  Network fee: max {formatEth(draft.maxFeeWei!, 8)} ETH · ≈ CHF {sim.chf} moved
                </p>
              )}
            </div>
            <div className="card">
              <h3>Swissquote's checks</h3>
              <div className="kv">
                {sim.checks.map((c) => (
                  <span key={c.text} style={{ display: "contents" }}>
                    <span className="k">{c.ok ? "✓" : "✗"}</span>
                    <span>{c.text}</span>
                  </span>
                ))}
              </div>
            </div>
            {sim.decision === "blocked" ? (
              <Banner kind="bad">⛔ {sim.reasons.join(" ")} Swissquote will not co-sign this request, and nothing was signed.</Banner>
            ) : (
              <>
                <Banner kind="ok">✓ Swissquote will co-sign this request.</Banner>
                {mode === "password" && <PasswordField label="Wallet password" value={password} onChange={setPassword} autoFocus />}
                {draft && (
                  <Btn onClick={confirm} busy={busy} disabled={mode === "password" && !password}>
                    {sim.tier === "high-value" ? `Approve with ${bio} + SMS` : `Approve with ${bio}`}
                  </Btn>
                )}
              </>
            )}
            <Btn kind="secondary" onClick={back}>
              Back
            </Btn>
          </>
        )}

        {phase === "otp" && (
          <>
            <Banner kind="info">✓ {bio} approved this exact request. It is above CHF {sim?.highValueChf}, so enter the SMS code too.</Banner>
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
            />
            <Btn onClick={confirmOtp} busy={busy} disabled={otp.length !== 6}>
              Co-sign &amp; send
            </Btn>
            <Btn kind="secondary" onClick={back}>
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
                <p className="mono small">{sent.hash}</p>
                <a href={`${cfg.explorer}/tx/${sent.hash}`} target="_blank" rel="noreferrer">
                  View on the explorer
                </a>
              </>
            )}
            {phase === "done" && (
              <div style={{ marginTop: 14 }}>
                <Btn onClick={back}>Done</Btn>
              </div>
            )}
          </div>
        )}
        {error && <div className="err">{error}</div>}
      </div>
    </>
  );
}
