import { useState } from "react";
import { bank, setToken, type ClientView } from "../lib/api";
import type { KeySource } from "../lib/envelope";
import { checkPartA, keySourceFor, wipeSource } from "../lib/keys";
import { authName, getPasskey, requirePrf } from "../lib/passkey";
import { deviceId, keyModeOf, type Profile } from "../lib/profile";
import { Banner, Btn, PasswordField, Top, short, useAsync } from "../ui";

// Log in = one biometric prompt that (1) signs the bank's challenge (server-verified passkey
// login) and (2) yields the PRF secret that proves this passkey can decrypt Part A on this device.
// On password-protected devices the password decrypts the key and the passkey logs in.
export function Unlock({ profile, notice, onUnlocked, onRecover }: { profile: Profile; notice?: string | null; onUnlocked: (c: ClientView | null) => void; onRecover: () => void }) {
  const { busy, error, run } = useAsync();
  const [offline, setOffline] = useState(false);
  const [password, setPassword] = useState("");
  const mode = keyModeOf(profile);
  const bio = authName();

  const unlock = () =>
    run(async () => {
      let src: KeySource | null = null;
      if (mode === "password") {
        src = await keySourceFor(profile, password);
        await checkPartA(profile, src); // wrong password fails fast, before any prompt
      }
      let options;
      try {
        options = await bank("/auth/passkey/options", "POST", { clientId: profile.clientId });
      } catch (e) {
        setOffline(true);
        const status = (e as { status?: number }).status;
        if (!status || status >= 500) throw new Error("Swissquote is unreachable. You can still use your wallet in self-custody mode.");
        throw e;
      }
      const res = await getPasskey({ serverOptions: options });
      if (mode === "prf") {
        src = { kind: "prf", prf: requirePrf(res) };
        await checkPartA(profile, src);
      }
      wipeSource(src);
      try {
        const r = await bank<{ token: string; client: ClientView }>("/auth/passkey/verify", "POST", { clientId: profile.clientId, deviceId: deviceId(), response: res.json });
        setToken(r.token);
        onUnlocked(r.client);
      } catch (e) {
        setOffline(true);
        throw e;
      }
    });

  const unlockOffline = () =>
    run(async () => {
      const src = await keySourceFor(profile, password);
      await checkPartA(profile, src);
      wipeSource(src);
      setToken(null);
      onUnlocked(null);
    });

  return (
    <>
      <Top />
      <div className="content" style={{ justifyContent: "center" }}>
        <img className="app-logo" src="/apple-touch-icon.png" alt="" />
        <h1 className="center">Welcome back, {profile.name.split(" ")[0]}</h1>
        <p className="muted center">
          Wallet {short(profile.address)} · {profile.clientId}
        </p>
        {notice && <Banner kind="warn">{notice}</Banner>}
        {mode === "password" && <PasswordField label="Wallet password" value={password} onChange={setPassword} autoFocus onEnter={unlock} />}
        <Btn onClick={unlock} busy={busy} disabled={mode === "password" && !password}>
          {mode === "password" ? `Unlock (password + ${bio})` : `Unlock with ${bio}`}
        </Btn>
        {offline && (
          <Btn kind="secondary" onClick={unlockOffline} busy={busy} disabled={mode === "password" && !password}>
            Continue without Swissquote
          </Btn>
        )}
        {error && <Banner kind={offline ? "warn" : "bad"}>{error}</Banner>}
        <Btn kind="link" onClick={onRecover}>
          Lost your {mode === "password" ? "password or passkey" : "passkey"}? Recover your wallet
        </Btn>
      </div>
    </>
  );
}
