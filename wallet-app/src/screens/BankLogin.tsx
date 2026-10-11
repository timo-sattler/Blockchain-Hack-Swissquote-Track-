import { useState } from "react";
import { bank, setToken, type ClientView, type MockDelivery } from "../lib/api";
import { deviceId } from "../lib/profile";
import { Banner, Btn, MockSms, useAsync } from "../ui";

// Step 1 of creation and recovery: prove you're the Swissquote client (client ID + password + SMS).
export function BankLogin({ intro, onDone }: { intro: string; onDone: (client: ClientView) => void }) {
  const [clientId, setClientId] = useState("SQ-100234");
  const [password, setPassword] = useState("Demo-1234");
  const [otp, setOtp] = useState("");
  const [delivery, setDelivery] = useState<MockDelivery | null>(null);
  const { busy, error, run } = useAsync();

  const start = () =>
    run(async () => {
      const r = await bank<{ mockDelivery: MockDelivery }>("/auth/login", "POST", { clientId, password, deviceId: deviceId() });
      setDelivery(r.mockDelivery);
    });

  const verify = () =>
    run(async () => {
      const r = await bank<{ token: string; client: ClientView }>("/auth/otp", "POST", { clientId, deviceId: deviceId(), code: otp });
      setToken(r.token);
      onDone(r.client);
    });

  return (
    <div className="content">
      <h1>Log in with Swissquote</h1>
      <p className="muted">{intro}</p>
      {!delivery ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <label className="f">Swissquote client ID</label>
          <input className="f" value={clientId} onChange={(e) => setClientId(e.target.value)} autoCapitalize="characters" autoComplete="username" />
          <label className="f">eBanking password</label>
          <input className="f" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Btn type="submit" busy={busy}>
            Continue
          </Btn>
          <Banner kind="mock">
            <b>MOCK bank.</b> Demo clients: <b>SQ-100234</b> / Demo-1234 (Anna Keller) · <b>SQ-100777</b> / Demo-5678 (Marco Rossi)
          </Banner>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <MockSms delivery={delivery} />
          <label className="f">6-digit SMS code</label>
          <input className="f" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} autoFocus />
          <Btn type="submit" busy={busy} disabled={otp.length !== 6}>
            Log in
          </Btn>
          <Btn kind="link" onClick={() => { setDelivery(null); setOtp(""); }}>
            Didn't get a code? Start again
          </Btn>
        </form>
      )}
      {error && <div className="err">{error}</div>}
    </div>
  );
}
