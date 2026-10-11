// Getting at Part A of the wallet's MPC key on this device: one biometric prompt (passkey PRF) or
// the wallet password, depending on how this device was set up.
import { wipe } from "./bytes";
import { open, type KeySource } from "./envelope";
import { getPasskey, requirePrf } from "./passkey";
import { keyModeOf, partAAad, type Profile } from "./profile";

export const MIN_PASSWORD = 10;

export async function passkeySource(credentialId: string): Promise<KeySource> {
  const pk = await getPasskey({ credentialIds: [credentialId] });
  return { kind: "prf", prf: requirePrf(pk) };
}

// Password-protected devices must pass the password; passkey devices trigger the prompt.
export async function keySourceFor(profile: Profile, password: string): Promise<KeySource> {
  if (keyModeOf(profile) === "password") {
    if (!password) throw new Error("Enter your wallet password.");
    return { kind: "password", password };
  }
  return passkeySource(profile.credentialId);
}

export function openPartA(profile: Profile, src: KeySource): Promise<Uint8Array> {
  return open(src, profile.encA, partAAad(profile.clientId, profile.publicKey));
}

// Throws (wrong password / wrong passkey) without keeping the part around.
export async function checkPartA(profile: Profile, src: KeySource): Promise<void> {
  wipe(await openPartA(profile, src));
}

export function wipeSource(src: KeySource | null | undefined) {
  if (src?.kind === "prf") wipe(src.prf);
}

export function newPasswordProblem(pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (/^(.)\1*$/.test(pw)) return "Pick a password that isn't one repeated character.";
  if (pw !== confirm) return "The two passwords don't match.";
  return null;
}

// iPhone/iPad: the share sheet ("Save to Files", AirDrop, print), because downloads from a home-screen
// app are unreliable there. Elsewhere: a normal download.
export async function downloadText(filename: string, text: string, type = "text/plain") {
  const file = new File([text], filename, { type });
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
