import { useEffect, useState } from "react";
import { bank, type ClientView } from "../lib/api";
import type { KeySource } from "../lib/envelope";
import { authName } from "../lib/passkey";
import type { Profile } from "../lib/profile";
import { provision, type ProvisionResult } from "../lib/provision";
import { ProtectDevice } from "../components/ProtectDevice";
import { RecoveryCardView } from "../components/RecoveryCard";
import { Banner, Btn, CameraCapture, Steps, Top, useAsync, type Photo } from "../ui";
import { BankLogin } from "./BankLogin";

type Step = "login" | "identity" | "protect" | "card" | "done";

export function Create({ onBack, onFinished }: { onBack: () => void; onFinished: (p: Profile) => void }) {
  const [step, setStep] = useState<Step>("login");
  const [client, setClient] = useState<ClientView | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const { busy, error, run } = useAsync();
  useEffect(() => {
    window.scrollTo(0, 0); // each step starts at the top (block body: newer browsers return a Promise)
  }, [step]);
  const idx = ["login", "identity", "protect", "card", "done"].indexOf(step);

  const afterLogin = (c: ClientView) => {
    setClient(c);
    if (c.wallet?.activatedAt) return setStep("done");
    setStep(c.hasKycPhoto ? "protect" : "identity");
  };

  const saveIdentity = () =>
    run(async () => {
      await bank("/kyc/reference-photo", "POST", { photo: photo!.dataUrl, photoSource: photo!.source });
      setStep("protect");
    });

  const createWallet = async (source: KeySource, credentialId: string, onStep: (s: string) => void) => {
    setResult(await provision({ clientId: client!.id, name: client!.name, source, credentialId, onStep }));
    setStep("card");
  };

  return (
    <>
      <Top title="Create wallet" onBack={step === "login" ? onBack : undefined} />
      {step !== "login" && (
        <div className="content-head">
          <Steps n={idx} of={4} />
        </div>
      )}
      {step === "login" && <BankLogin intro="Your wallet is linked to your existing Swissquote client identity, so we start with your eBanking login." onDone={afterLogin} />}

      {step === "identity" && (
        <div className="content">
          <h1>Hi {client?.name.split(" ")[0]} 👋</h1>
          <p className="muted">If you ever lose this device, Swissquote checks it's really you by comparing a live selfie with your ID photo on file.</p>
          <Banner kind="mock">
            <b>MOCK onboarding.</b> In production Swissquote already has your passport photo from the video identification at account opening. For the
            demo, take a photo with your camera now to stand in for it.
          </Banner>
          <CameraCapture onPhoto={setPhoto} label="Take reference photo" />
          <Btn onClick={saveIdentity} disabled={!photo} busy={busy}>
            Continue
          </Btn>
          {error && <div className="err">{error}</div>}
        </div>
      )}

      {step === "protect" && (
        <ProtectDevice
          heading={`Protect your wallet with ${authName()}`}
          intro={
            <div className="card">
              <div className="kv">
                <span className="k">Your key</span>
                <span>Created in three parts (MPC). The whole key never exists, not even on this device.</span>
                <span className="k">Part A</span>
                <span>On this device, encrypted with a passkey ({authName()}).</span>
                <span className="k">Part B</span>
                <span>Swissquote's Share Vault. It co-signs your payments after screening them, and can never move funds alone.</span>
                <span className="k">Part C</span>
                <span>Locked by your paper Recovery Card. Any two parts sign or recover.</span>
              </div>
            </div>
          }
          cta="Create wallet"
          onProtect={createWallet}
        />
      )}

      {step === "card" && result && (
        <div className="content">
          <RecoveryCardView card={result.card} clientId={result.profile.clientId} address={result.profile.address} backupFile={result.backupFile} onConfirmed={() => setStep("done")} />
        </div>
      )}

      {step === "done" && (
        <div className="content">
          <div className="big-ico">✅</div>
          {result ? (
            <>
              <h1 className="center">Your Swissquote Wallet is ready</h1>
              <div className="card">
                <div className="kv">
                  <span className="k">Ethereum</span>
                  <span className="mono">{result.profile.address}</span>
                  <span className="k">Bitcoin</span>
                  <span className="mono">{result.profile.btcAddress}</span>
                  <span className="k">Linked to</span>
                  <span>
                    {client?.name} · {client?.id}
                  </span>
                  <span className="k">Travel Rule</span>
                  <span>
                    <span className="badge ok">✓ ownership verified</span>
                  </span>
                </div>
              </div>
              <Btn onClick={() => onFinished(result.profile)}>Open my wallet</Btn>
            </>
          ) : (
            <>
              <h1 className="center">You already have a Swissquote Wallet</h1>
              <p className="muted center">Use "Recover my wallet" to restore it on this device.</p>
              <Btn onClick={onBack}>Back</Btn>
            </>
          )}
        </div>
      )}
    </>
  );
}
