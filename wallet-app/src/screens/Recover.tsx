import { useEffect, useRef, useState } from "react";
import { bank, vault, type ClientView } from "../lib/api";
import { wipe } from "../lib/bytes";
import { cardOf, newCardKey, openPartC, parseCardText, sealPartC, type EncC, type PaperCard } from "../lib/card";
import { kdfOf, open, type Envelope, type KeySource } from "../lib/envelope";
import { passkeySource, wipeSource } from "../lib/keys";
import { PART_A, PART_C, refreshKey } from "../lib/mpc";
import { authName } from "../lib/passkey";
import { backupFileOf, deviceLabel, partAAad, type BackupFile, type Profile } from "../lib/profile";
import { secureDevice } from "../lib/provision";
import { entropyOfMnemonic } from "../lib/walletcore";
import { ProtectDevice } from "../components/ProtectDevice";
import { RecoveryCardView } from "../components/RecoveryCard";
import { Banner, Btn, CameraCapture, PasswordField, Top, useAsync, type Photo } from "../ui";
import { BankLogin } from "./BankLogin";

type Path = "passkey" | "file" | "paper";
type Step = "login" | "path" | "selfie" | "wait" | "protect" | "second" | "newcard" | "done" | "nowallet";
interface RecoveryView {
  id: string;
  status: "pending_kyc" | "timelock" | "released" | "completed" | "rejected" | "cancelled" | "abandoned" | "expired";
  path: Path;
  secondsLeft: number | null;
  expectedAddress: string | null;
}

function parseBackupFile(text: string): BackupFile {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Swissquote encrypted backup file.");
  }
  if (j?.kind !== "swissquote-wallet/mpc-backup" || !j.partA?.ct || !j.publicKey) throw new Error("That file isn't a Swissquote wallet backup file (MPC).");
  return j as BackupFile;
}

export function Recover({ onBack, onFinished }: { onBack: () => void; onFinished: (p: Profile) => void }) {
  const [step, setStep] = useState<Step>("login");
  const [client, setClient] = useState<ClientView | null>(null);
  const [path, setPath] = useState<Path>("passkey");
  const [selfie, setSelfie] = useState<Photo | null>(null);
  const [rec, setRec] = useState<RecoveryView | null>(null);
  const [cardWords, setCardWords] = useState("");
  const [backupFile, setBackupFile] = useState<BackupFile | null>(null);
  const [filePassword, setFilePassword] = useState("");
  const [card, setCard] = useState<PaperCard | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const { busy, error, run, setError } = useAsync();
  useEffect(() => {
    window.scrollTo(0, 0); // each step starts at the top (block body: newer browsers return a Promise)
  }, [step]);
  const cardFileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  // The part the client still has, collected BEFORE this device creates its new passkey: creating it
  // replaces the synced passkey for this account on the same authenticator.
  const haveRef = useRef<{ lost: typeof PART_A | typeof PART_C; part?: Uint8Array; words?: string } | null>(null);
  const bio = authName();

  useEffect(
    () => () => {
      wipe(haveRef.current?.part);
    },
    []
  );

  const afterLogin = (c: ClientView) =>
    run(async () => {
      setClient(c);
      if (!c.wallet?.activatedAt) return setStep("nowallet");
      const { recovery } = await bank<{ recovery: RecoveryView | null }>("/recovery/current");
      if (recovery && ["pending_kyc", "timelock", "released"].includes(recovery.status)) {
        setRec(recovery);
        setPath(recovery.path);
        setStep("wait");
      } else {
        setPath(c.hasBackupA ? "passkey" : "paper");
        setStep("path");
      }
    });

  useEffect(() => {
    if (step !== "wait") return;
    const poll = async () => {
      const r = await bank<{ recovery: RecoveryView | null }>("/recovery/current").catch(() => null);
      if (r?.recovery) setRec(r.recovery);
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [step]);

  const startRecovery = () =>
    run(async () => {
      const { recovery } = await bank<{ recovery: RecoveryView }>("/recovery/start", "POST", { selfie: selfie!.dataUrl, selfieSource: selfie!.source, path, deviceLabel: deviceLabel() });
      setRec(recovery);
      setStep("wait");
    });

  const abandon = () =>
    run(async () => {
      if (rec && ["pending_kyc", "timelock", "released"].includes(rec.status)) await bank(`/recovery/${rec.id}/abandon`, "POST");
      setRec(null);
      setSelfie(null);
      setStep("path");
    });

  // Time-lock over: Swissquote marks the recovery released, which lets this device add a passkey.
  const proceed = () =>
    run(async () => {
      await bank(`/recovery/${rec!.id}/recover-ticket`, "POST");
      setStep("second");
    });

  const walletKey = async () => (await vault<{ publicKey: string }>(`/v1/keys/${encodeURIComponent(client!.id)}`)).publicKey;

  async function openPartA(env: Envelope, src: KeySource, publicKey: string) {
    try {
      return await open(src, env, partAAad(client!.id, publicKey));
    } finally {
      wipeSource(src);
    }
  }

  const keep = (have: { lost: typeof PART_A | typeof PART_C; part?: Uint8Array; words?: string }) => {
    wipe(haveRef.current?.part);
    haveRef.current = have;
    setStep("protect");
  };

  const recoverWithPasskey = () =>
    run(async () => {
      const [{ backupA }, publicKey] = await Promise.all([bank<{ backupA: Envelope }>("/wallet/backup"), walletKey()]);
      keep({ lost: PART_C, part: await openPartA(backupA, await passkeySource(backupA.credentialId), publicKey) });
    });

  const recoverWithFile = () =>
    run(async () => {
      const f = backupFile!;
      if (f.clientId && f.clientId !== client!.id) throw new Error(`This backup file belongs to ${f.clientId}, not ${client!.id}.`);
      if (f.publicKey !== (await walletKey())) throw new Error("This backup file is from an older key. Use your newest backup file.");
      const src: KeySource = kdfOf(f.partA) === "pbkdf2-sha256" ? { kind: "password", password: filePassword } : await passkeySource(f.partA.credentialId);
      if (src.kind === "password" && !filePassword) throw new Error("Enter the wallet password you set for this backup.");
      keep({ lost: PART_C, part: await openPartA(f.partA, src, f.publicKey) });
    });

  const recoverWithCard = () =>
    run(async () => {
      await entropyOfMnemonic(cardWords); // typos are caught here; the words open Part C during the refresh
      keep({ lost: PART_A, words: cardWords });
    });

  // The part the client still has + the vault's Part B refresh all three parts. Same address; the
  // old parts (including the copy on a lost device and the old paper card) stop working with
  // Swissquote. Part A is sealed for this device at once and the new card is shown right away.
  const refresh = async (source: KeySource, credentialId: string, onStep: (s: string) => void) => {
    const have = haveRef.current;
    if (!have) throw new Error("Recovery state was lost. Go back and provide your passkey, backup file or card again.");
    const cardKey = newCardKey();
    try {
      onStep("Swissquote's vault and your part are rebuilding your key (MPC)…");
      const { ticket } = await bank<{ ticket: string }>(`/recovery/${rec!.id}/recover-ticket`, "POST");
      const sealed: { encC?: EncC } = {};
      const parts = await refreshKey(
        ticket,
        have.lost,
        async (encC, pk) => {
          if (have.part) return new Uint8Array(have.part);
          if (!encC) throw new Error("Swissquote holds no encrypted recovery part for this wallet.");
          return openPartC(encC, have.words!, client!.id, pk);
        },
        async (c, pk) => (sealed.encC = await sealPartC(c, cardKey, client!.id, pk)),
        (n) => onStep(`Refreshing all three key parts (round ${n} of 4)…`)
      );
      try {
        onStep("Protecting Part A on this device…");
        const p = await secureDevice({ clientId: client!.id, name: client!.name, parts, encC: sealed.encC!, source, credentialId, uploadBackup: true });
        if (p.address.toLowerCase() !== rec!.expectedAddress?.toLowerCase()) throw new Error("The rebuilt key doesn't match your wallet address.");
        onStep("Finishing the recovery with Swissquote…");
        await bank(`/recovery/${rec!.id}/complete`, "POST", { address: p.address });
        wipe(have.part);
        haveRef.current = null;
        setCard(await cardOf(cardKey));
        setProfile(p);
        setStep("newcard");
      } finally {
        wipe(parts.a, parts.c);
      }
    } finally {
      wipe(cardKey);
    }
  };

  async function loadCardFile(f: File) {
    const words = parseCardText(await f.text());
    if (!words) return setError("That file doesn't look like a Swissquote Recovery Card");
    setError(null);
    setCardWords(words);
  }

  async function loadBackupFile(f: File) {
    try {
      setBackupFile(parseBackupFile(await f.text()));
      setError(null);
    } catch (e) {
      setBackupFile(null);
      setError((e as Error).message);
    }
  }

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const canPasskey = Boolean(client?.hasBackupA);
  const wordCount = cardWords.trim() ? cardWords.trim().split(/\s+/).length : 0;

  const pathOption = (p: Path, title: string, body: string, disabled = false) => (
    <button className={`card option ${path === p ? "selected" : ""}`} onClick={() => !disabled && setPath(p)} disabled={disabled}>
      <h3>
        {path === p ? "◉" : "○"} {title}
      </h3>
      <p className="muted small">{body}</p>
    </button>
  );

  return (
    <>
      <Top title="Recover wallet" onBack={["login", "path", "nowallet"].includes(step) ? onBack : undefined} />
      {step === "login" && (
        <>
          <BankLogin intro="Lost your device, passkey or password? Start by logging in with your Swissquote client ID." onDone={afterLogin} />
          {error && (
            <div className="content" style={{ paddingTop: 0 }}>
              <Banner kind="bad">{error}</Banner>
            </div>
          )}
        </>
      )}

      {step === "nowallet" && (
        <div className="content">
          <h1>No wallet to recover</h1>
          <p className="muted">This client doesn't have an active Swissquote Wallet yet.</p>
          <Btn onClick={onBack}>Back</Btn>
        </div>
      )}

      {step === "path" && (
        <div className="content">
          <h1>What do you still have?</h1>
          <p className="muted">
            Your key has three parts and any two restore it. Swissquote's vault takes part with Part B, after checking it's you. Still have another device
            with the wallet? Use <b>Add a device</b> there instead: it's instant.
          </p>
          {pathOption(
            "passkey",
            "My passkey (synced)",
            canPasskey
              ? "A device signed into the same iCloud Keychain / Google Password Manager / password manager that holds your passkey. Unlocks Part A, which Swissquote stores encrypted."
              : "Not available: this wallet was protected with a wallet password, so Swissquote holds no passkey-encrypted Part A.",
            !canPasskey
          )}
          {pathOption("file", "My encrypted backup file", "The swissquote-encrypted-backup-….json file you saved, plus its wallet password (or passkey). Holds Part A.")}
          {pathOption("paper", "My paper Recovery Card", "Everything else is gone. Your 24 words unlock Part C.")}
          <p className="muted small">Either way, all three parts are refreshed: you set up a new passkey for this device and get a new Recovery Card.</p>
          <Btn onClick={() => setStep("selfie")}>Continue</Btn>
        </div>
      )}

      {step === "selfie" && (
        <div className="content">
          <h1>Confirm it's you</h1>
          <p className="muted">
            A Swissquote identity specialist compares a live selfie with your ID photo on file. Then a <b>security delay</b> starts, and all your devices
            and your e-mail get an alert, so you can stop anyone pretending to be you.
          </p>
          <CameraCapture onPhoto={setSelfie} />
          <Btn onClick={startRecovery} disabled={!selfie} busy={busy}>
            Start recovery
          </Btn>
          <Btn kind="link" onClick={() => setStep("path")}>
            Back
          </Btn>
          {error && <Banner kind="bad">{error}</Banner>}
        </div>
      )}

      {step === "wait" && rec && (
        <div className="content">
          {rec.status === "pending_kyc" && (
            <>
              <div className="big-ico">🕵️</div>
              <h1 className="center">Checking your identity…</h1>
              <p className="muted center">A specialist is comparing your selfie with your ID photo. This usually takes a few minutes.</p>
              <Banner kind="mock">
                <b>MOCK video-ident.</b> Approve or reject in the operator console:{" "}
                <a href="/portal/kyc.html" target="_blank" rel="noreferrer">
                  /portal/kyc.html
                </a>{" "}
                (PIN kyc-demo).
              </Banner>
            </>
          )}
          {rec.status === "timelock" && (
            <>
              <div className="big-ico">⏱️</div>
              <h1 className="center">Identity confirmed</h1>
              <p className="muted center">For your protection, Swissquote's vault only takes part after a security delay. Your other devices have been notified.</p>
              {(rec.secondsLeft ?? 0) > 0 ? (
                <div className="countdown">{mm(rec.secondsLeft!)}</div>
              ) : (
                <Btn onClick={proceed} busy={busy}>
                  Continue
                </Btn>
              )}
            </>
          )}
          {rec.status === "released" && (
            <>
              <div className="big-ico">🔓</div>
              <h1 className="center">Swissquote is ready to rebuild your key</h1>
              <Btn onClick={proceed} busy={busy}>
                Continue
              </Btn>
            </>
          )}
          {["pending_kyc", "timelock", "released"].includes(rec.status) && (
            <Btn kind="link" onClick={abandon} busy={busy}>
              Start over with a different recovery method
            </Btn>
          )}
          {rec.status === "rejected" && (
            <>
              <div className="big-ico">⛔</div>
              <h1 className="center">Recovery refused</h1>
              <Banner kind="bad">The identity check failed: the selfie doesn't match the client's ID documents. Swissquote's vault won't take part, and the client has been alerted.</Banner>
            </>
          )}
          {rec.status === "cancelled" && (
            <>
              <div className="big-ico">⛔</div>
              <h1 className="center">Recovery blocked</h1>
              <Banner kind="bad">The account owner cancelled this recovery from a trusted device. Recovery is now frozen for this client.</Banner>
            </>
          )}
          {(rec.status === "expired" || rec.status === "abandoned") && (
            <>
              <div className="big-ico">⌛</div>
              <h1 className="center">This recovery {rec.status === "expired" ? "expired" : "was stopped"}</h1>
              <Btn onClick={abandon}>Start a new recovery</Btn>
            </>
          )}
          {["rejected", "cancelled", "completed"].includes(rec.status) && <Btn onClick={onBack}>Back</Btn>}
          {error && <Banner kind="bad">{error}</Banner>}
        </div>
      )}

      {step === "second" && (
        <div className="content">
          <Banner kind="ok">✓ Swissquote is ready. Now the part you still have:</Banner>
          {path === "passkey" && (
            <>
              <p className="muted">Your synced passkey decrypts Part A, which Swissquote stores encrypted and can't read itself.</p>
              <Btn onClick={recoverWithPasskey} busy={busy}>
                Unlock with {bio}
              </Btn>
            </>
          )}
          {path === "file" && (
            <>
              <p className="muted">Load your encrypted backup file. It holds Part A, encrypted with your wallet password or passkey.</p>
              <input ref={backupFileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && loadBackupFile(e.target.files[0])} />
              <Btn kind="secondary" onClick={() => backupFileRef.current?.click()}>
                {backupFile ? "✓ File loaded. Choose another" : "Choose backup file"}
              </Btn>
              {backupFile && kdfOf(backupFile.partA) === "pbkdf2-sha256" && (
                <PasswordField label="Wallet password used for this backup" value={filePassword} onChange={setFilePassword} autoFocus onEnter={recoverWithFile} />
              )}
              <Btn onClick={recoverWithFile} busy={busy} disabled={!backupFile || (kdfOf(backupFile.partA) === "pbkdf2-sha256" && !filePassword)}>
                {backupFile && kdfOf(backupFile.partA) === "webauthn-prf" ? `Unlock with ${bio}` : "Open my backup"}
              </Btn>
            </>
          )}
          {path === "paper" && (
            <>
              <label className="f">24 words (in order, separated by spaces) {wordCount > 0 && <span className="muted">· {wordCount}/24</span>}</label>
              <textarea className="f" value={cardWords} onChange={(e) => setCardWords(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <input ref={cardFileRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => e.target.files?.[0] && loadCardFile(e.target.files[0])} />
              <Btn kind="secondary" onClick={() => cardFileRef.current?.click()}>
                Load from downloaded card file
              </Btn>
              <Btn onClick={recoverWithCard} busy={busy} disabled={wordCount !== 24}>
                Continue
              </Btn>
            </>
          )}
          <div className="row wrap center-row">
            {path !== "passkey" && canPasskey && (
              <Btn kind="link" onClick={() => setPath("passkey")}>
                Use my passkey
              </Btn>
            )}
            {path !== "file" && (
              <Btn kind="link" onClick={() => setPath("file")}>
                Use my backup file
              </Btn>
            )}
            {path !== "paper" && (
              <Btn kind="link" onClick={() => setPath("paper")}>
                Use my paper card
              </Btn>
            )}
          </div>
          {error && <Banner kind="bad">{error}</Banner>}
        </div>
      )}

      {step === "protect" && (
        <>
          <div className="content-head">
            <Banner kind="ok">✓ Your part is ready. Last step: protect this device. Then Swissquote's vault refreshes all three key parts with it.</Banner>
          </div>
          <ProtectDevice heading={`Secure this device with ${bio}`} cta="Finish recovery" onProtect={refresh} />
          <div className="content" style={{ paddingTop: 0 }}>
            <Btn kind="link" onClick={() => setStep("second")}>
              Back
            </Btn>
          </div>
        </>
      )}

      {step === "newcard" && card && profile && (
        <div className="content">
          <Banner kind="ok">✓ Wallet recovered and protected on this device. All three key parts were refreshed. Write down your new card below and destroy the old one.</Banner>
          <RecoveryCardView card={card} clientId={profile.clientId} address={profile.address} backupFile={backupFileOf(profile)} onConfirmed={() => setStep("done")} />
        </div>
      )}

      {step === "done" && profile && (
        <div className="content">
          <div className="big-ico">🎉</div>
          <h1 className="center">Welcome back, {profile.name.split(" ")[0]}</h1>
          <p className="muted center">Your wallet {profile.address.slice(0, 10)}… is restored on this device. Same address, same funds.</p>
          <Btn onClick={() => onFinished(profile)}>Open my wallet</Btn>
        </div>
      )}
    </>
  );
}
