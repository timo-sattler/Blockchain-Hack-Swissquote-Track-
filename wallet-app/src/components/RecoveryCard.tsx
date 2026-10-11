import { useMemo, useState } from "react";
import { cardText, type PaperCard } from "../lib/card";
import { kdfOf } from "../lib/envelope";
import { downloadText } from "../lib/keys";
import type { BackupFile } from "../lib/profile";
import { Banner, Btn } from "../ui";

export function backupFileName(b: BackupFile) {
  return `swissquote-encrypted-backup-${b.clientId}.json`;
}

export function RecoveryCardView({
  card,
  clientId,
  address,
  backupFile,
  onConfirmed,
}: {
  card: PaperCard;
  clientId: string;
  address: string;
  backupFile?: BackupFile;
  onConfirmed: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [backupSaved, setBackupSaved] = useState(false);
  const [answer, setAnswer] = useState("");
  const ask = useMemo(() => 1 + Math.floor(Math.random() * 24), []);
  const correct = answer.trim().toLowerCase() === card.words[ask - 1];
  // With a wallet password Swissquote doesn't keep Part A, so the file is the client's copy.
  const passwordMode = backupFile ? kdfOf(backupFile.partA) === "pbkdf2-sha256" : false;

  function download() {
    downloadText(`swissquote-recovery-card-${clientId}.txt`, cardText(card, clientId, address));
    setSaved(true);
  }

  function print() {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return download();
    const pre = w.document.createElement("pre");
    pre.textContent = cardText(card, clientId, address);
    pre.style.cssText = "font: 15px/1.5 ui-monospace, Consolas, monospace; padding: 24px; white-space: pre-wrap";
    w.document.title = `Swissquote Recovery Card ${clientId}`;
    w.document.body.appendChild(pre);
    w.focus();
    w.print();
    setSaved(true);
  }

  return (
    <>
      <h1>Your paper Recovery Card</h1>
      <p className="muted">
        These 24 words unlock <b>Part C</b>, one of the three parts of your wallet's key. On their own they can't move your funds. Write them down or print
        them and keep them somewhere safe, like a home safe. You need them if you lose this device or your {passwordMode ? "password" : "passkey"}, or to
        pay while Swissquote is unreachable.
      </p>
      <div className="card">
        <div className="words">
          {card.words.map((w, i) => (
            <div key={i}>
              <b>{i + 1}</b>
              {w}
            </div>
          ))}
        </div>
      </div>
      <div className="row wrap">
        <Btn kind="secondary" onClick={print}>
          🖨 Print
        </Btn>
        <Btn kind="secondary" onClick={download}>
          ⬇ Download
        </Btn>
        <Btn kind="secondary" onClick={() => setSaved(true)}>
          ✍ I wrote it down
        </Btn>
      </div>
      {backupFile && (
        <div className="card">
          <h3>Encrypted backup file {passwordMode ? "(important)" : "(optional)"}</h3>
          <p className="muted small">
            {passwordMode
              ? "Because this device uses a wallet password, Swissquote does not keep your encrypted Part A. Save this file somewhere other than this device (e.g. your own cloud drive or a USB stick). File + password restore your wallet with Swissquote, or with your paper card."
              : "Your passkey-encrypted Part A (Swissquote stores the same copy) and your card-encrypted Part C. Useful if you ever recover without Swissquote."}
          </p>
          <Btn
            kind="secondary"
            onClick={() => {
              downloadText(backupFileName(backupFile), JSON.stringify(backupFile, null, 2), "application/json");
              setBackupSaved(true);
            }}
          >
            {backupSaved ? "✓ Saved. Download again" : "⬇ Download encrypted backup file"}
          </Btn>
        </div>
      )}
      {saved && (
        <div className="card">
          <label className="f">To check, type word #{ask}</label>
          <input
            className="f"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && correct && onConfirmed()}
          />
          <div style={{ height: 10 }} />
          <Btn onClick={onConfirmed} disabled={!correct}>
            Continue
          </Btn>
        </div>
      )}
      <Banner kind="info">
        Swissquote never sees this card. It holds Part B, which only co-signs payments it has screened, and only helps restore your wallet after an identity
        check and a security delay.
      </Banner>
    </>
  );
}
