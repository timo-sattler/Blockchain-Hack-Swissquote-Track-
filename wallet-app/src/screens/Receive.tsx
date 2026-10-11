import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cachedConfig, config, type PublicConfig } from "../lib/api";
import type { Profile } from "../lib/profile";
import { Banner, Btn, Top, useCopy } from "../ui";

export function Receive({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const [cfg, setCfg] = useState<PublicConfig>(cachedConfig());
  const [qr, setQr] = useState<string>("");
  const [copied, copy] = useCopy();
  useEffect(() => {
    config().then(setCfg);
  }, []);
  useEffect(() => {
    // EIP-681 payment URI, understood by most wallet apps' QR scanners.
    QRCode.toDataURL(`ethereum:${profile.address}@${cfg.chainId}`, { margin: 1, width: 440 }).then(setQr);
  }, [profile.address, cfg.chainId]);
  return (
    <>
      <Top title="Receive" onBack={onBack} />
      <div className="content">
        <div className="card center">
          {qr && <img className="qr" src={qr} alt="QR code of your wallet address" />}
          <p className="mono">{profile.address}</p>
          <Btn kind="secondary" onClick={() => copy(profile.address)}>
            {copied ? "Copied ✓" : "Copy address"}
          </Btn>
        </div>
        {cfg.network.testnet ? (
          <Banner kind="info">
            Only send <b>{cfg.network.name} ETH</b> to this address. Need some? Use a faucet
            {cfg.network.faucets.map((f) => (
              <span key={f}>
                {" · "}
                <a href={f} target="_blank" rel="noreferrer">
                  {new URL(f).hostname}
                </a>
              </span>
            ))}
            {cfg.treasuryTopup ? ", or “Top up from your Swissquote account” on the home screen." : "."}
          </Banner>
        ) : (
          <Banner kind="warn">
            This is an <b>Ethereum mainnet</b> address. Only send ETH on Ethereum (chain {cfg.chainId}); coins sent on other networks may be lost.
          </Banner>
        )}
        <div className="card">
          <h3>Same key, also Bitcoin</h3>
          <p className="muted small">
            Trust Wallet Core turns the same MPC public key into a Bitcoin address, controlled by the same key parts. This app only sends on Ethereum for now, so
            don't send Bitcoin here yet:
          </p>
          <p className="mono small">{profile.btcAddress}</p>
        </div>
      </div>
    </>
  );
}
