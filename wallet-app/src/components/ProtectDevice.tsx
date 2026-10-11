import { useState, type ReactNode } from "react";
import { wipe } from "../lib/bytes";
import type { KeySource } from "../lib/envelope";
import { newPasswordProblem, MIN_PASSWORD } from "../lib/keys";
import { authName, passkeysAvailable } from "../lib/passkey";
import { registerPasskey } from "../lib/provision";
import { Banner, Btn, PasswordField, useAsync } from "../ui";

// Sets up how this device unlocks the wallet: a passkey whose PRF output encrypts Part A of the key,
// or, when the passkey provider has no PRF (common with Windows Hello), the passkey for Swissquote
// logins and payment approvals plus a wallet password that encrypts Part A.
export function ProtectDevice({
  heading,
  intro,
  cta,
  onProtect,
  register = registerPasskey,
}: {
  heading: string;
  intro?: ReactNode;
  cta?: string;
  onProtect: (src: KeySource, credentialId: string, onStep: (s: string) => void) => Promise<void>;
  register?: () => Promise<{ credentialId: string; prf: Uint8Array | null }>;
}) {
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [progress, setProgress] = useState("");
  const { busy, error, run } = useAsync();
  const bio = authName();

  const withPasskey = () =>
    run(async () => {
      if (!passkeysAvailable()) throw new Error("Passkeys need a secure page. Open the app at http://localhost:5173 or via its https link.");
      setProgress(`Creating your passkey with ${bio}…`);
      const r = await register();
      if (!r.prf) {
        setProgress("");
        setCredentialId(r.credentialId);
        return;
      }
      try {
        await onProtect({ kind: "prf", prf: r.prf }, r.credentialId, setProgress);
      } finally {
        wipe(r.prf);
      }
    });

  const withPassword = () =>
    run(async () => {
      const problem = newPasswordProblem(pw, pw2);
      if (problem) throw new Error(problem);
      await onProtect({ kind: "password", password: pw }, credentialId!, setProgress);
    });

  if (credentialId) {
    return (
      <div className="content">
        <div className="big-ico">🔑</div>
        <h1 className="center">Set a wallet password</h1>
        <Banner kind="info">
          Your passkey works for logging in to Swissquote, but this device's passkey provider can't encrypt keys (no WebAuthn PRF support, common with Windows
          Hello). Your part of the wallet key will be encrypted with a password instead.
        </Banner>
        <PasswordField label={`Wallet password (at least ${MIN_PASSWORD} characters)`} value={pw} onChange={setPw} autoFocus autoComplete="new-password" />
        <PasswordField label="Repeat the password" value={pw2} onChange={setPw2} autoComplete="new-password" onEnter={withPassword} />
        <p className="muted small">
          Swissquote never sees this password and can't reset it. You need it to unlock and to send. If you forget it, recover the wallet with your paper
          Recovery Card.
        </p>
        {progress && busy && <Banner kind="info">{progress}</Banner>}
        <Btn onClick={withPassword} busy={busy} disabled={!pw || !pw2}>
          {cta ?? "Continue"}
        </Btn>
        {error && <div className="err">{error}</div>}
      </div>
    );
  }

  return (
    <div className="content">
      <div className="big-ico">🔐</div>
      <h1 className="center">{heading}</h1>
      {intro}
      {progress && busy && <Banner kind="info">{progress}</Banner>}
      <Btn onClick={withPasskey} busy={busy}>
        Protect with {bio}
      </Btn>
      {error && <div className="err">{error}</div>}
      <p className="muted small center">
        Your browser shows its passkey dialog. You may be asked twice: once to create the passkey and once to derive your encryption key. No {bio}? Pick “Use a
        phone or tablet” in the dialog.
      </p>
    </div>
  );
}
