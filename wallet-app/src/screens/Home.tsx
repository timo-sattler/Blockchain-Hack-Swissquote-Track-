import { useCallback, useEffect, useState } from "react";
import { bank, cachedConfig, config, type ClientView, type PublicConfig } from "../lib/api";
import { balance, formatEth, formatUnits, history, tokenBalance, tokenHistory, type ChainTx, type TokenTx } from "../lib/eth";
import type { Profile } from "../lib/profile";
import { BankIcon, ProfileIcon, ReceiveIcon, SendIcon } from "../icons";
import { Banner, Btn, Top, short, useAsync, useCopy } from "../ui";

interface Notification {
  id: string;
  at: string;
  title: string;
  body: string;
  actionable?: boolean;
  recoveryId?: string;
}
interface Activity {
  id: string;
  at: string;
  type: string;
  hash?: string;
  eth?: number;
  units?: number;
  asset?: string;
  to?: string;
  explorer?: string;
  tier?: string;
}
interface Row {
  hash: string;
  at: string | null;
  label: string;
  amount: string;
  incoming: boolean;
  status: "ok" | "failed" | "pending";
}

export function Home({ profile, client, go }: { profile: Profile; client: ClientView | null; go: (r: "send" | "receive" | "settings") => void }) {
  const [bal, setBal] = useState<bigint | null>(null);
  const [balErr, setBalErr] = useState(false);
  const [cfg, setCfg] = useState<PublicConfig>(cachedConfig());
  const [notes, setNotes] = useState<Notification[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [chainTxs, setChainTxs] = useState<ChainTx[] | null>(null);
  const [tokenTxs, setTokenTxs] = useState<TokenTx[]>([]);
  const [tokenBals, setTokenBals] = useState<Record<string, bigint | null>>({});
  const [custody, setCustody] = useState<number | null>(client?.accounts.ethCustody ?? null);
  const [recoveries, setRecoveries] = useState<{ id: string; status: string; deviceLabel: string; secondsLeft: number | null }[]>([]);
  const [topUp, setTopUp] = useState("0.002");
  const [topUpMsg, setTopUpMsg] = useState<string | null>(null);
  const [copied, copy] = useCopy();
  const { busy, error, run } = useAsync();
  const me = profile.address.toLowerCase();

  const refresh = useCallback(async () => {
    balance(profile.address)
      .then((b) => {
        setBal(b);
        setBalErr(false);
      })
      .catch(() => setBalErr(true));
    for (const [sym, t] of Object.entries(cachedConfig().tokens)) {
      tokenBalance(t.address, profile.address)
        .then((b) => setTokenBals((prev) => ({ ...prev, [sym]: b })))
        .catch(() => {});
    }
    if (!client) return;
    bank("/bank/overview")
      .then((o) => {
        setNotes(o.notifications);
        setActivity(o.activity);
        setCustody(o.client.accounts.ethCustody);
        setRecoveries(o.recoveries);
      })
      .catch(() => {});
  }, [profile.address, client]);

  const refreshHistory = useCallback(() => {
    history(profile.address)
      .then(setChainTxs)
      .catch(() => setChainTxs((prev) => prev ?? null));
    if (Object.keys(cachedConfig().tokens).length)
      tokenHistory(profile.address)
        .then(setTokenTxs)
        .catch(() => {});
  }, [profile.address]);

  useEffect(() => {
    config().then(setCfg);
    refresh();
    refreshHistory();
    const t = setInterval(refresh, 6000);
    const h = setInterval(refreshHistory, 15000);
    return () => {
      clearInterval(t);
      clearInterval(h);
    };
  }, [refresh, refreshHistory]);

  const doTopUp = () =>
    run(async () => {
      setTopUpMsg(null);
      const r = await bank("/bank/withdraw", "POST", { amountEth: topUp });
      setTopUpMsg(r.explorer);
      refresh();
    });

  const cancelRecovery = (id: string) =>
    run(async () => {
      await bank(`/recovery/${id}/cancel`, "POST");
      refresh();
    });

  const pending = recoveries.filter((r) => r.status === "pending_kyc" || r.status === "timelock");
  const chf = bal !== null ? (Number(formatEth(bal, 8)) * cfg.ethChf).toFixed(2) : null;
  const treasury = cfg.treasuryAddress?.toLowerCase();

  // On-chain history is the source of truth; transactions the bank knows about but the explorer
  // hasn't indexed yet show as pending.
  const rows: Row[] = [];
  if (chainTxs) {
    for (const t of chainTxs) {
      const incoming = t.from.toLowerCase() !== me;
      const other = incoming ? t.from : t.to || "";
      const label = incoming
        ? other.toLowerCase() === treasury
          ? "From your Swissquote account"
          : `Received from ${short(other)}`
        : other.toLowerCase() === treasury
          ? "To your Swissquote account"
          : `Sent to ${short(other)}${t.method && t.method !== "transfer" ? ` (${t.method})` : ""}`;
      // Token transfers sent by this wallet are listed below with their amount, not as 0 ETH calls.
      if (!incoming && t.valueWei === 0n && t.method === "transfer") continue;
      rows.push({ hash: t.hash, at: t.timestamp, label, amount: `${incoming ? "+" : "−"}${formatEth(t.valueWei)} ETH`, incoming, status: t.status });
    }
  }
  for (const t of tokenTxs) {
    const incoming = t.to.toLowerCase() === me;
    const other = incoming ? t.from : t.to;
    const sponsored = !incoming && !chainTxs?.some((c) => c.hash.toLowerCase() === t.hash.toLowerCase());
    rows.push({
      hash: t.hash,
      at: t.timestamp,
      label: `${incoming ? `Received from ${short(other)}` : `Sent to ${short(other)}`}${sponsored ? " · fee paid by Swissquote" : ""}`,
      amount: `${incoming ? "+" : "−"}${formatUnits(t.value, t.decimals, 2)} ${t.symbol}`,
      incoming,
      status: "ok",
    });
  }
  const known = new Set(rows.map((r) => r.hash.toLowerCase()));
  for (const a of activity) {
    if (!a.hash || known.has(a.hash.toLowerCase())) continue;
    if (chainTxs && Date.now() - Date.parse(a.at) > 10 * 60_000) continue; // indexed long ago or dropped
    const incoming = a.type === "bank-withdrawal";
    rows.push({
      hash: a.hash,
      at: a.at,
      label: incoming ? "From your Swissquote account" : `Sent to ${short(a.to || "")}`,
      amount: `${incoming ? "+" : "−"}${a.asset && a.asset !== "ETH" ? `${a.units} ${a.asset}` : `${a.eth} ETH`}`,
      incoming,
      status: chainTxs ? "pending" : "ok",
    });
  }
  rows.sort((x, y) => (y.at || "9").localeCompare(x.at || "9"));

  return (
    <>
      <Top
        right={
          <button className="round" onClick={() => go("settings")} aria-label="Profile and settings">
            <ProfileIcon />
          </button>
        }
      />
      <div className="content wide">
        {pending.map((r) => (
          <Banner kind="bad" key={r.id}>
            <b>⚠️ Someone is trying to recover your wallet</b> from "{r.deviceLabel}" ({r.status === "pending_kyc" ? "identity check pending" : `releases in ${r.secondsLeft}s`}).
            <div style={{ marginTop: 8 }}>
              <Btn kind="danger" onClick={() => cancelRecovery(r.id)} busy={busy}>
                That wasn't me. Block it
              </Btn>
            </div>
          </Banner>
        ))}
        {!client && (
          <Banner kind="warn">Self-custody mode: Swissquote is offline. You can still send with your paper Recovery Card (Part A + Part C on this device), without compliance checks.</Banner>
        )}
        {!cfg.network.testnet && <Banner kind="warn">⚠️ Ethereum mainnet: this wallet holds real ETH. Transactions can't be reversed.</Banner>}

        <div className="home-grid">
          <div className="col">
            <div className="hero">
              <div className="label">Swissquote Wallet · {cfg.network.name}</div>
              <div className="amount">{bal === null ? (balErr ? "—" : "…") : formatEth(bal)} ETH</div>
              <div className="sub">{balErr && bal === null ? "Balance unavailable (network unreachable)" : chf ? `≈ CHF ${chf}` : " "}</div>
              {Object.keys(cfg.tokens).length > 0 && (
                <div className="row wrap" style={{ marginTop: 6 }}>
                  {Object.entries(cfg.tokens).map(([sym, t]) => (
                    <span className="badge" key={sym}>
                      {tokenBals[sym] == null ? "…" : formatUnits(tokenBals[sym]!, t.decimals, 2)} {sym}
                    </span>
                  ))}
                </div>
              )}
              <div className="row wrap" style={{ marginTop: 10 }}>
                <span className="badge ok">✓ Your keys · MPC 2 of 3</span>
                <span className="badge">{profile.clientId}</span>
                {client?.wallet?.travelRule && <span className="badge ok">Travel Rule ✓</span>}
              </div>
              <button className="addr" onClick={() => copy(profile.address)} title="Copy address">
                {profile.address} {copied ? "✓ copied" : "⧉"}
              </button>
            </div>

            <div className="actions">
              <button className="action" onClick={() => go("send")}>
                <span className="ico">
                  <SendIcon />
                </span>
                Send
              </button>
              <button className="action" onClick={() => go("receive")}>
                <span className="ico">
                  <ReceiveIcon />
                </span>
                Receive
              </button>
              <a className="action" href="/portal/" target="_blank" rel="noreferrer">
                <span className="ico">
                  <BankIcon />
                </span>
                eBanking
              </a>
            </div>

            {bal === 0n && cfg.network.testnet && (
              <Banner kind="info">
                Your wallet is empty. Get free test ETH from a Sepolia faucet
                {cfg.network.faucets.length > 0 && (
                  <>
                    {" "}
                    (
                    {cfg.network.faucets.map((f, i) => (
                      <span key={f}>
                        {i > 0 && ", "}
                        <a href={f} target="_blank" rel="noreferrer">
                          {new URL(f).hostname}
                        </a>
                      </span>
                    ))}
                    )
                  </>
                )}{" "}
                using the address above{cfg.treasuryTopup ? ", or top up from your Swissquote account" : ""}.
                {cfg.tokenFaucet && (
                  <>
                    {" "}
                    Test USDC and EURC:{" "}
                    <a href={cfg.tokenFaucet} target="_blank" rel="noreferrer">
                      {new URL(cfg.tokenFaucet).hostname}
                    </a>{" "}
                    (choose Ethereum Sepolia). Swissquote pays the network fee when you send them.
                  </>
                )}
              </Banner>
            )}

            {client && cfg.treasuryTopup && (
              <div className="card">
                <h3>Top up from your Swissquote account</h3>
                <p className="muted small">
                  You hold {custody ?? "…"} ETH at Swissquote. It moves to your own wallet right away: Swissquote already has proof this wallet is yours.
                </p>
                <div className="row">
                  <input className="f" value={topUp} onChange={(e) => setTopUp(e.target.value)} inputMode="decimal" style={{ flex: 1 }} aria-label="Amount in ETH" />
                  <div style={{ width: 130 }}>
                    <Btn onClick={doTopUp} busy={busy}>
                      Move
                    </Btn>
                  </div>
                </div>
                {topUpMsg && (
                  <p className="small">
                    Sent.{" "}
                    <a href={topUpMsg} target="_blank" rel="noreferrer">
                      View on the explorer
                    </a>
                    . The balance updates in about 15s.
                  </p>
                )}
                {error && <div className="err small">{error}</div>}
              </div>
            )}
          </div>

          <div className="col">
            <div className="card">
              <h3>Transactions</h3>
              {rows.length === 0 && <p className="muted small">{chainTxs === null && !client ? "Loading…" : "No transactions yet."}</p>}
              {rows.slice(0, 10).map((r) => (
                <div className="list-item" key={r.hash}>
                  <div>
                    <div>{r.label}</div>
                    <div className="muted small">
                      {r.at ? new Date(r.at).toLocaleString("de-CH") : "just now"}
                      {r.status === "pending" && <span className="badge warn"> pending</span>}
                      {r.status === "failed" && <span className="badge bad"> failed</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div className={r.incoming ? "in" : ""}>{r.amount}</div>
                    <a className="small" href={`${cfg.explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">
                      Explorer
                    </a>
                  </div>
                </div>
              ))}
              <a className="small" href={`${cfg.explorer}/address/${profile.address}`} target="_blank" rel="noreferrer">
                Full history on the explorer ↗
              </a>
            </div>

            {client && notes.length > 0 && (
              <div className="card">
                <h3>Security notifications</h3>
                {notes.slice(0, 4).map((n) => (
                  <div className="list-item" key={n.id}>
                    <div>
                      <div>
                        <b>{n.title}</b>
                      </div>
                      <div className="muted small">{n.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
