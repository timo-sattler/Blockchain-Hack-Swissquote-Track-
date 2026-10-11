import { useState } from "react";
import type { ClientView } from "../lib/api";
import { authName, passkeysAvailable } from "../lib/passkey";
import type { Profile } from "../lib/profile";
import { restoreWithPasskey } from "../lib/provision";
import { Banner, Btn, Top, useAsync } from "../ui";

// The client already has a wallet and this device has its passkey (synced by iCloud Keychain or
// Google Password Manager): client ID + Face ID opens the wallet here, no recovery needed.
export function SignIn({ onBack, onRecover, onSignedIn }: { onBack: () => void; onRecover: () => void; onSignedIn: (p: Profile, c: ClientView) => void }) {
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("");
  const { busy, error, run } = useAsync();
  const bio = authName();

  const signIn = () =>
    run(async () => {
      const r = await restoreWithPasskey(clientId.trim().toUpperCase(), setStatus);
      onSignedIn(r.profile, r.client);
    });

  return (
    <>
      <Top title="Sign in" onBack={onBack} />
      <div className="content">
        <h1>Open your wallet on this device</h1>
        <p className="muted">
          Enter your Swissquote client ID and confirm with {bio}. This works when your passkey is on this device, for example synced by iCloud Keychain to
          your new iPhone.
        </p>
        <label className="f">Client ID</label>
        <input
          className="f"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="SQ-100234"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username webauthn"
          onKeyDown={(e) => e.key === "Enter" && clientId && signIn()}
        />
        <Btn onClick={signIn} busy={busy} disabled={!clientId.trim() || !passkeysAvailable()}>
          Sign in with {bio}
        </Btn>
        {busy && status && <p className="muted small center">{status}</p>}
        {error && <Banner kind="bad">{error}</Banner>}
        <div className="card">
          <h3>No passkey on this device?</h3>
          <p className="muted small">
            On a device that already has your wallet: <b>Profile → Devices → Add a device</b>, then scan the QR code here. Lost every device? Recover with
            your paper Recovery Card or backup file.
          </p>
          <Btn kind="secondary" onClick={onRecover}>
            I lost my device. Recover my wallet
          </Btn>
        </div>
      </div>
    </>
  );
}
