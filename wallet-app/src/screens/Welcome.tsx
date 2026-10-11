import { useEffect, useState } from "react";
import { cachedConfig, config, type PublicConfig } from "../lib/api";
import { authName, passkeysAvailable } from "../lib/passkey";
import { Banner, Btn, InstallHint, Top } from "../ui";

export function Welcome({ onCreate, onRecover }: { onCreate: () => void; onRecover: () => void }) {
  const [cfg, setCfg] = useState<PublicConfig>(cachedConfig());
  useEffect(() => {
    config().then(setCfg);
  }, []);
  return (
    <>
      <Top />
      <div className="content" style={{ justifyContent: "center" }}>
        <img className="app-logo" src="/apple-touch-icon.png" alt="" />
        <h1 className="center">Your keys. Swiss safety.</h1>
        <p className="muted center">
          A self-custody wallet linked to your Swissquote account. Your key is split in three parts and never exists in one place. {authName()} protects
          yours, Swissquote screens every payment it co-signs, and if you lose this device it helps you get the wallet back, but it can never move your funds.
        </p>
        <Btn onClick={onCreate}>Create my Swissquote Wallet</Btn>
        <Btn kind="secondary" onClick={onRecover}>
          I lost my device. Recover my wallet
        </Btn>
        <InstallHint />
        {!passkeysAvailable() && (
          <Banner kind="warn">Passkeys need a secure page. Open this app at http://localhost:5173 on this computer, or on a phone through its https link (npm run tunnel, see GUIDE.md).</Banner>
        )}
        {!cfg.network.testnet && <Banner kind="warn">⚠️ This server runs on Ethereum mainnet: wallets hold real ETH.</Banner>}
        <Banner kind="mock">
          <b>Prototype.</b> Real: 2-of-3 MPC key (DKLs23), Trust Wallet Core transactions, passkeys, gasless USDC/EURC, {cfg.network.name}. MOCK: bank, SMS,
          KYC provider, share vault operator.
        </Banner>
      </div>
    </>
  );
}
