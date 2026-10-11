import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackIcon, BankIcon, HomeIcon, ProfileIcon, ReceiveIcon, SendIcon, SqMark } from "./icons";
import { authName } from "./lib/passkey";

// Swissquote Crypto wordmark: the round orange mark, "Swissquote" and "Crypto" in blue.
export const Wordmark = () => (
  <span className="wordmark">
    <SqMark />
    Swissquote <span>Crypto</span>
  </span>
);

// Swissquote-style header: the wordmark on the left (or a round back button and a centered title),
// round actions on the right.
export function Top({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className={`top ${title === undefined && !onBack ? "home" : ""}`}>
      {onBack && (
        <button className="round left" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
      )}
      <div className="brand">{title ?? <Wordmark />}</div>
      {right && <div className="right">{right}</div>}
    </div>
  );
}

// Text tabs with an orange underline, as in the Swissquote app (Watchlists · Markets · News).
export function SubNav<T extends string>({ items, active, onChange }: { items: [T, string][]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="subnav" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={active === k} className={active === k ? "on" : ""} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// Grey pill segments, as in the Swissquote app (Shares · Crypto · Indices).
export function Segments<T extends string>({ items, active, onChange }: { items: T[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="seg">
      {items.map((k) => (
        <button key={k} className={active === k ? "on" : ""} aria-pressed={active === k} onClick={() => onChange(k)}>
          {k}
        </button>
      ))}
    </div>
  );
}

export type Tab = "home" | "send" | "receive" | "settings";

// Bottom tab bar, as in the Swissquote app. "Bank" opens the eBanking portal.
export function TabBar({ active, go }: { active: Tab; go: (t: Tab) => void }) {
  const item = (t: Tab, label: string, icon: ReactNode) => (
    <button className={active === t ? "on" : ""} onClick={() => go(t)} aria-current={active === t ? "page" : undefined}>
      {icon}
      {label}
    </button>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      {item("home", "Home", <HomeIcon />)}
      {item("send", "Send", <SendIcon />)}
      {item("receive", "Receive", <ReceiveIcon />)}
      <a href="/portal/" target="_blank" rel="noreferrer">
        <BankIcon />
        Bank
      </a>
      {item("settings", "Profile", <ProfileIcon />)}
    </nav>
  );
}

export function Btn(props: { children: ReactNode; onClick?: () => unknown; kind?: "primary" | "secondary" | "dark" | "danger" | "link"; disabled?: boolean; busy?: boolean; type?: "button" | "submit" }) {
  const { kind = "primary", busy, disabled, onClick, children, type = "button" } = props;
  return (
    <button type={type} className={`btn ${kind === "primary" ? "" : kind}`} disabled={disabled || busy} onClick={onClick}>
      {busy && <span className={`spinner ${kind === "secondary" || kind === "link" ? "dark" : ""}`} />}
      {children}
    </button>
  );
}

export function Banner({ kind = "info", children }: { kind?: "info" | "warn" | "bad" | "ok" | "mock"; children: ReactNode }) {
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function MockSms({ delivery }: { delivery?: { code?: string; to?: string } | null }) {
  if (!delivery?.code) return null;
  return (
    <Banner kind="mock">
      <b>MOCK SMS</b> to {delivery.to}: your Swissquote code is <b style={{ fontSize: 18, letterSpacing: 2 }}>{delivery.code}</b>
    </Banner>
  );
}

export function Steps({ n, of }: { n: number; of: number }) {
  return (
    <div className="steps">
      {Array.from({ length: of }, (_, i) => (
        <div key={i} className={i < n ? "on" : ""} />
      ))}
    </div>
  );
}

export function PasswordField(props: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete?: string; onEnter?: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="f">{props.label}</label>
      <div className="pw">
        <input
          className="f"
          type={show ? "text" : "password"}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoFocus={props.autoFocus}
          autoComplete={props.autoComplete ?? "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(e) => e.key === "Enter" && props.onEnter?.()}
        />
        <button type="button" className="pw-toggle" onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export interface Photo {
  dataUrl: string;
  source: "camera" | "upload";
}

// Center-crops to a square JPEG so uploads stay small but faces stay recognisable.
function squareJpeg(src: CanvasImageSource, w: number, h: number, size = 480): string {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const s = Math.min(w, h);
  c.getContext("2d")!.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.85);
}

const isFirefox = () => /Firefox|FxiOS/.test(navigator.userAgent);

function unblockSteps(): string {
  return isFirefox()
    ? "In Firefox, click the crossed-out camera icon at the left of the address bar and remove the block (“Blocked temporarily” or “Blocked”), then press the camera button again. Saved blocks are listed under about:preferences#privacy → Permissions → Camera → Settings."
    : "Click the icon at the left of the address bar → Site settings → Camera → Allow, then press the camera button again.";
}

const WINDOWS_CAMERA_HINT = "On Windows, also check Settings → Privacy & security → Camera → “Let desktop apps access your camera”.";

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return `Camera access is blocked for this site. ${unblockSteps()}`;
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "No camera was found on this device. Upload a photo instead.";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") {
    return `The camera couldn't start. It may be in use by another app or browser tab (Zoom, Teams, Camera app…): close it and try again. ${WINDOWS_CAMERA_HINT}`;
  }
  return `The camera could not start (${(e as Error)?.message || name}). Upload a photo instead.`;
}

// Errors where a second try with the plainest possible request often works (picky webcam drivers).
const RETRY_PLAIN = new Set(["OverconstrainedError", "NotReadableError", "AbortError", "NotFoundError", "TrackStartError"]);

async function cameraPermission(): Promise<PermissionStatus | null> {
  try {
    return await navigator.permissions.query({ name: "camera" as PermissionName });
  } catch {
    return null; // browser can't report it; just ask
  }
}

type CameraPhase = "idle" | "asking" | "live" | "done";

// Live selfie from the webcam / front camera, with a photo upload as fallback. Every state is
// visible: waiting for the browser's permission popup, blocked, no picture, busy camera.
export function CameraCapture({ onPhoto, label = "Take selfie" }: { onPhoto: (p: Photo | null) => void; label?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const attemptRef = useRef(0);
  const permRef = useRef<PermissionStatus | null>(null);
  const [phase, setPhase] = useState<CameraPhase>("idle");
  const [waiting, setWaiting] = useState(false);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  };

  useEffect(
    () => () => {
      attemptRef.current++;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (permRef.current) permRef.current.onchange = null;
    },
    []
  );

  // Attach the stream once the <video> is on screen, and make sure real frames arrive.
  useEffect(() => {
    if (phase !== "live" || !videoRef.current || !streamRef.current) return;
    const v = videoRef.current;
    const onFrames = () => v.videoWidth > 0 && setReady(true);
    v.addEventListener("loadeddata", onFrames);
    v.addEventListener("resize", onFrames);
    v.srcObject = streamRef.current;
    v.play().catch(() => {});
    const noPicture = setTimeout(() => {
      if (v.videoWidth > 0) return;
      stopStream();
      setPhase("idle");
      setErr(`The camera opened but sent no picture. Close other apps or tabs using it and try again. ${WINDOWS_CAMERA_HINT}`);
    }, 8000);
    return () => {
      clearTimeout(noPicture);
      v.removeEventListener("loadeddata", onFrames);
      v.removeEventListener("resize", onFrames);
    };
  }, [phase]);

  async function start() {
    const attempt = ++attemptRef.current;
    const current = () => attemptRef.current === attempt;
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(window.isSecureContext ? "This browser can't open the camera. Upload a photo instead." : "The camera needs a secure page: open the app at http://localhost:5173 or its https link. Or upload a photo instead.");
      return;
    }
    stopStream();
    setPhase("asking");
    const slow = setTimeout(() => current() && setWaiting(true), 1000);
    try {
      const perm = await cameraPermission();
      if (perm) {
        permRef.current = perm;
        // When the user unblocks the camera in the browser, clear the message so they can retry.
        perm.onchange = () => perm.state !== "denied" && setErr(null);
        if (perm.state === "denied") throw Object.assign(new Error("blocked"), { name: "NotAllowedError" });
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        if (!RETRY_PLAIN.has((e as { name?: string })?.name || "")) throw e;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (!current()) {
        stream.getTracks().forEach((t) => t.stop()); // cancelled while the popup was open
        return;
      }
      streamRef.current = stream;
      setPreview(null);
      onPhoto(null);
      setPhase("live");
    } catch (e) {
      if (!current()) return;
      console.error("camera:", (e as { name?: string })?.name, e);
      setErr(cameraError(e));
      setPhase(preview ? "done" : "idle");
    } finally {
      clearTimeout(slow);
      if (current()) setWaiting(false);
    }
  }

  function cancel() {
    attemptRef.current++;
    stopStream();
    setWaiting(false);
    setPhase(preview ? "done" : "idle");
  }

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return setErr("The camera isn't ready yet. Wait a second and try again.");
    const url = squareJpeg(v, v.videoWidth, v.videoHeight);
    stopStream();
    setPreview(url);
    setPhase("done");
    onPhoto({ dataUrl: url, source: "camera" });
  }

  async function upload(file: File) {
    setErr(null);
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      const url = squareJpeg(img, img.naturalWidth, img.naturalHeight);
      attemptRef.current++;
      stopStream();
      setWaiting(false);
      setPreview(url);
      setPhase("done");
      onPhoto({ dataUrl: url, source: "upload" });
    } catch {
      setErr("That file isn't an image we can read. Use a JPEG or PNG.");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return (
    <div className="camera-box">
      {phase === "live" && (
        <>
          <div className="camera">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="camera-guide" />
            {!ready && <div className="camera-status">Starting camera…</div>}
          </div>
          <div className="row">
            <Btn kind="secondary" onClick={cancel}>
              Cancel
            </Btn>
            <Btn onClick={snap} disabled={!ready}>
              📸 Capture
            </Btn>
          </div>
        </>
      )}
      {phase === "asking" && (
        <>
          <Btn kind="dark" busy>
            Waiting for camera permission…
          </Btn>
          {waiting && (
            <Banner kind="info">
              <b>Your browser is asking to use the camera.</b> Click <b>Allow</b> in the popup
              {isFirefox() ? " that opens under the camera icon at the left of the address bar" : " near the address bar"}. Don't see it? Click the camera icon in
              the address bar.
            </Banner>
          )}
          <Btn kind="secondary" onClick={cancel}>
            Cancel
          </Btn>
        </>
      )}
      {phase === "done" && preview && (
        <>
          <img className="selfie" src={preview} alt="Your photo" />
          <Btn kind="secondary" onClick={start}>
            📷 Retake
          </Btn>
        </>
      )}
      {phase === "idle" && (
        <Btn kind="dark" onClick={start}>
          📷 {label}
        </Btn>
      )}
      {phase !== "live" && (
        <Btn kind="link" onClick={() => fileRef.current?.click()}>
          No camera? Upload a photo instead
        </Btn>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(f);
        }}
      />
      {err && <Banner kind="bad">{err}</Banner>}
    </div>
  );
}

// Turns browser / WebAuthn exceptions into something a client can act on.
export function friendlyError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  const msg = e instanceof Error ? e.message : String(e);
  if (name === "NotAllowedError" || /The operation either timed out or was not allowed/i.test(msg)) {
    return `The ${authName()} / passkey prompt was cancelled or timed out. Try again.`;
  }
  if (name === "InvalidStateError") return "This device already holds a passkey for this wallet. Try again; if it keeps failing, delete the old passkey for this site in your passkey settings.";
  if (name === "NotSupportedError") {
    return "This browser can't create a passkey here. On Windows, turn on Windows Hello (Settings → Accounts → Sign-in options → PIN), or choose “Use a phone or tablet” in the passkey dialog.";
  }
  if (name === "SecurityError") return "Passkeys need a secure address. Open the app at http://localhost:5173 (not an IP address) or via its https link.";
  if (name === "AbortError" || name === "TimeoutError") return "The request took too long. Check your connection and try again.";
  return msg;
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    (text: string) => {
      navigator.clipboard
        ?.writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {});
    },
  ];
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// On an iPhone in Safari: how to install the wallet as an app on the home screen.
export function InstallHint() {
  if (!isIos() || isStandalone()) return null;
  return (
    <div className="banner info install-hint">
      <b>📲 Use it as an app:</b> tap <b>Share</b>{" "}
      <svg aria-hidden width="14" height="17" viewBox="0 0 14 17" style={{ verticalAlign: "-2px" }} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 1v10M3.5 4.5 7 1l3.5 3.5M4.5 7.5H2.5v8.5h9V7.5h-2" />
      </svg>{" "}
      in Safari, then <b>Add to Home Screen</b>. The wallet then opens full screen from its own icon,
      with Face ID.
    </div>
  );
}
