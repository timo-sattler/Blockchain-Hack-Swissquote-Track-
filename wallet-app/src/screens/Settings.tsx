import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { bank, setToken, type ClientView } from "../lib/api";
import { createInvite, linkIsLocal } from "../lib/devices";
import { downloadText, keySourceFor } from "../lib/keys";
import { authName } from "../lib/passkey";
import { backupFileOf, keyModeOf, wipeDevice, type Profile } from "../lib/profile";
import { backupFileName } from "../components/RecoveryCard";
import { Banner, Btn, PasswordField, Top, useAsync, useCopy } from "../ui";

type Device = { id: string; deviceLabel: string; revoked: boolean; createdAt?: string; lastUsedAt?: string };

export function Settings({ profile, client, onBack, onLock, onWiped }: { profile: Profile; client: ClientView | null; onBack: () => void; onLock: () => void; onWiped: () => void }) {
  const [password, setPassword] = useState("");
  const [devices, setDevices] = useState<Device[]>(client?.credentials ?? []);
  const [invite, setInvite] = useState<{ link: string; qr: string; expires: number } | null>(null);
  const [copied, copy] = useCopy();
  const { busy, error, run } = useAsync();
  const mode = keyModeOf(profile);
  const bio = authName();

  const refreshDevices = () =>
    bank<{ client: ClientView }>("/me")
      .then((r) => setDevices(r.client.credentials))
      .catch(() => {});

  useEffect(() => {
    if (client) refreshDevices();
  }, [client]);

  const addDevice = () =>
    run(async () => {
      const r = await createInvite(profile, await keySourceFor(profile, password));
      setPassword("");
      setInvite({ ...r, qr: await QRCode.toDataURL(r.link, { margin: 1, width: 440 }) });
    });

  const reportLost = (d: Device) =>
    run(async () => {
      if (!confirm(`Remove "${d.deviceLabel}"? Swissquote stops accepting its passkey, so it can no longer approve payments with Swissquote.`)) return;
      await bank(`/devices/${encodeURIComponent(d.id)}/report-lost`, "POST");
      await refreshDevices();
    });

  const downloadBackup = () => downloadText(backupFileName(backupFileOf(profile)), JSON.stringify(backupFileOf(profile), null, 2), "application/json");

  const removeFromDevice = () => {
    if (!confirm("Remove the wallet from this device? To use it here again, add it from another device or recover it (Swissquote + your passkey, backup file or paper card).")) return;
    wipeDevice();
    setToken(null);
    onWiped();
  };

  const active = devices.filter((d) => !d.revoked);

  return (
    <>
      <Top title="Settings" onBack={onBack} />
      <div className="content">
        <div className="card">
          <div className="kv">
            <span className="k">Client</span>
            <span>
              {profile.name} · {profile.clientId}
            </span>
            <span className="k">Wallet</span>
            <span className="mono">{profile.address}</span>
            <span className="k">Unlock</span>
            <span>{mode === "password" ? `Wallet password (+ ${bio} for Swissquote logins and approvals)` : `Passkey with ${bio}`}</span>
            <span className="k">Passkey</span>
            <span className="mono small">{profile.credentialId.slice(0, 22)}…</span>
            <span className="k">Custody</span>
            <span>Self-custody, 2-of-3 MPC. Swissquote holds one part and can never move funds alone.</span>
          </div>
        </div>

        <div className="card">
          <h3>How your key works</h3>
          <div className="kv">
            <span className="k">Part A</span>
            <span>On this device{active.length > 1 ? ` and ${active.length - 1} other device${active.length > 2 ? "s" : ""}` : ""}, encrypted with {mode === "password" ? "your wallet password" : bio}.</span>
            <span className="k">Part B</span>
            <span>Swissquote's Share Vault. Co-signs a payment only after screening it and your {bio} approval.</span>
            <span className="k">Part C</span>
            <span>Locked by your paper Recovery Card. With Part A it pays without Swissquote; with Part B it recovers your wallet.</span>
          </div>
          <p className="muted small">
            The whole private key never exists, so there are no 24 seed words to export. Trust Wallet Core builds and compiles every transaction; the parts
            co-sign its hash (version {profile.keyVersion}).
          </p>
          <Btn kind="secondary" onClick={downloadBackup}>
            Download encrypted backup file (Part A + Part C)
          </Btn>
        </div>

        {client && (
          <div className="card">
            <h3>Devices</h3>
            {active.map((d) => (
              <div className="list-item" key={d.id}>
                <div>
                  <div>
                    {d.deviceLabel} {d.id === profile.credentialId && <span className="badge ok">this device</span>}
                  </div>
                  <div className="muted small">{d.lastUsedAt ? `last used ${new Date(d.lastUsedAt).toLocaleString("de-CH")}` : "not used yet"}</div>
                </div>
                {d.id !== profile.credentialId && (
                  <Btn kind="link" onClick={() => reportLost(d)} busy={busy}>
                    Remove
                  </Btn>
                )}
              </div>
            ))}
            {invite ? (
              <div className="center">
                {linkIsLocal(invite.link) && (
                  <Banner kind="warn">
                    This link points to this computer (localhost), which a phone can't open. For a phone, run <b>npm run tunnel</b> on this computer, then tap
                    Done and Add a device again.
                  </Banner>
                )}
                <img className="qr" src={invite.qr} alt="QR code to add a device" />
                <p className="muted small">
                  Scan with your new device's camera, or send the link to yourself. Valid until {new Date(invite.expires).toLocaleTimeString("de-CH")} and for
                  one device. Don't share it: together with your login it gives that device your wallet.
                </p>
                <Btn kind="secondary" onClick={() => copy(invite.link)}>
                  {copied ? "Copied ✓" : "Copy link"}
                </Btn>
                <Btn kind="link" onClick={() => setInvite(null)}>
                  Done
                </Btn>
              </div>
            ) : (
              <>
                <p className="muted small">Add your phone, tablet or another computer: it gets an identical copy of Part A and its own {bio}.</p>
                {mode === "password" && <PasswordField label="Wallet password" value={password} onChange={setPassword} onEnter={addDevice} />}
                <Btn kind="secondary" onClick={addDevice} busy={busy} disabled={mode === "password" && !password}>
                  ➕ Add a device
                </Btn>
              </>
            )}
          </div>
        )}

        <div className="card">
          <h3>This device</h3>
          <div className="stack">
            <Btn kind="secondary" onClick={onLock}>
              🔒 Lock wallet
            </Btn>
            <Btn kind="danger" onClick={removeFromDevice}>
              📵 Remove wallet from this device (simulate losing it)
            </Btn>
          </div>
        </div>

        <div className="card">
          <h3>Demo consoles (MOCK)</h3>
          <div className="stack">
            <a className="btn secondary" href="/portal/" target="_blank" rel="noreferrer">
              eBanking portal
            </a>
            <a className="btn secondary" href="/portal/kyc.html" target="_blank" rel="noreferrer">
              KYC operator console
            </a>
            <a className="btn secondary" href="/portal/outbox.html" target="_blank" rel="noreferrer">
              SMS / e-mail outbox
            </a>
          </div>
        </div>
        {!client && <Banner kind="warn">Swissquote is offline: devices can't be added or removed right now.</Banner>}
        {error && <Banner kind="bad">{error}</Banner>}
      </div>
    </>
  );
}
