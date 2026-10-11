import { useRef, useState } from "react";
import type { ClientView } from "../lib/api";
import { wipe } from "../lib/bytes";
import { openInvite, type DeviceLink, type JoinResult } from "../lib/devices";
import type { KeySource } from "../lib/envelope";
import { publicKeyOfPart, hexOf } from "../lib/mpc";
import { authName } from "../lib/passkey";
import type { Profile } from "../lib/profile";
import { registerPasskey, secureDevice } from "../lib/provision";
import { ProtectDevice } from "../components/ProtectDevice";
import { Banner, Btn, Top } from "../ui";
import { BankLogin } from "./BankLogin";

// Opened from an "Add a device" link: log in as the client, register this device's own passkey with
// the invite, and decrypt the copy of Part A the other device sent. Same wallet, same address.
export function AddDevice({ link, onBack, onFinished }: { link: DeviceLink; onBack: () => void; onFinished: (p: Profile) => void }) {
  const [client, setClient] = useState<ClientView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const joined = useRef<JoinResult | null>(null);

  const afterLogin = (c: ClientView) => {
    if (c.id !== link.clientId) return setError(`This link is for client ${link.clientId}, but you logged in as ${c.id}.`);
    setError(null);
    setClient(c);
  };

  const register = async () => {
    const r = await registerPasskey({ options: "/devices/join/options", verify: "/devices/join/verify", extra: { inviteToken: link.inviteToken } });
    joined.current = r.result as unknown as JoinResult;
    return r;
  };

  const join = async (source: KeySource, credentialId: string, onStep: (s: string) => void) => {
    const j = joined.current!;
    onStep("Decrypting your copy of Part A…");
    const a = await openInvite(link, j);
    try {
      const pk = await publicKeyOfPart(a);
      if (hexOf(pk) !== j.publicKey) throw new Error("This key part does not belong to your wallet. Aborted.");
      onStep(`Protecting Part A with ${authName()} on this device…`);
      const profile = await secureDevice({ clientId: client!.id, name: client!.name, parts: { a, publicKey: pk, version: j.version }, encC: j.encC, source, credentialId, uploadBackup: false });
      if (profile.address.toLowerCase() !== j.wallet.address.toLowerCase()) throw new Error("This key part does not match your wallet address. Aborted.");
      history.replaceState(null, "", location.pathname);
      onFinished(profile);
    } finally {
      wipe(a);
    }
  };

  return (
    <>
      <Top title="Add this device" onBack={client ? undefined : onBack} />
      {!client && (
        <>
          <BankLogin intro="You opened an invite from your other device. Log in with your Swissquote client ID to add this device to your wallet." onDone={afterLogin} />
          {error && (
            <div className="content" style={{ paddingTop: 0 }}>
              <Banner kind="bad">{error}</Banner>
            </div>
          )}
        </>
      )}
      {client && (
        <ProtectDevice
          heading={`Protect this device with ${authName()}`}
          intro={
            <Banner kind="info">
              This device gets its own passkey and an identical copy of Part A of your key. Payments still need Swissquote's co-signature (Part B), and you
              can remove this device at any time from your other devices.
            </Banner>
          }
          cta="Add this device"
          register={register}
          onProtect={join}
        />
      )}
      {client && (
        <div className="content" style={{ paddingTop: 0 }}>
          <Btn kind="link" onClick={onBack}>
            Cancel
          </Btn>
        </div>
      )}
    </>
  );
}
