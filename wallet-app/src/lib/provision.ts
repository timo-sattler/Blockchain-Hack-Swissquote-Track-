import { bank } from "./api";
import { wipe } from "./bytes";
import { cardOf, newCardKey, sealPartC, type EncC, type PaperCard } from "./card";
import { seal, type KeySource } from "./envelope";
import { createKey, hexOf, signLocally, type KeyParts } from "./mpc";
import { createPasskey, getPasskey } from "./passkey";
import { backupFileOf, deviceLabel, partAAad, saveProfile, type BackupFile, type Profile } from "./profile";
import { addressesOf, finishSignature, personalMessageHash, signatureHex } from "./walletcore";

// Registers a passkey with the bank (server-verified) and tries to obtain its PRF secret.
// Some platforms only return PRF output on get(), which costs one extra biometric prompt.
// prf is null when the provider can't do PRF (common with Windows Hello): the caller then
// protects Part A with a wallet password instead.
// `paths` lets the add-a-device flow register through its invite instead of a passkey session.
export async function registerPasskey(
  paths: { options: string; verify: string; extra?: Record<string, unknown> } = { options: "/passkey/register/options", verify: "/passkey/register/verify" }
): Promise<{ credentialId: string; prf: Uint8Array | null; result: Record<string, unknown> }> {
  const options = await bank(paths.options, "POST", paths.extra ?? {});
  const created = await createPasskey(options);
  const result = await bank(paths.verify, "POST", { ...(paths.extra ?? {}), response: created.json, deviceLabel: deviceLabel() });
  if (created.prf) return { credentialId: created.credentialId, prf: created.prf, result };
  if (created.prfEnabled === false) return { credentialId: created.credentialId, prf: null, result };
  const got = await getPasskey({ credentialIds: [created.credentialId] });
  return { credentialId: created.credentialId, prf: got.prf, result };
}

export interface ProvisionResult {
  profile: Profile;
  card: PaperCard;
  backupFile: BackupFile;
}

// Seals Part A for this device, stores it (passkey mode: Swissquote keeps the same passkey-encrypted
// copy, which it can't read; password mode: only the client's backup file has it, because Swissquote
// could brute-force a password) and saves the device profile.
export async function secureDevice(opts: {
  clientId: string;
  name: string;
  parts: Pick<KeyParts, "a" | "publicKey" | "version">;
  encC: EncC;
  source: KeySource;
  credentialId: string;
  uploadBackup: boolean;
}): Promise<Profile> {
  const publicKey = hexOf(opts.parts.publicKey);
  const { address, btcAddress } = await addressesOf(opts.parts.publicKey);
  const encA = await seal(opts.source, "part-a", opts.credentialId, opts.parts.a, partAAad(opts.clientId, publicKey));
  const profile: Profile = { clientId: opts.clientId, name: opts.name, address, btcAddress, publicKey, credentialId: opts.credentialId, encA, encC: opts.encC, keyVersion: opts.parts.version, createdAt: new Date().toISOString() };
  saveProfile(profile); // first: the refreshed parts exist nowhere else yet
  if (opts.uploadBackup) await bank("/wallet/backup", "PUT", { backupA: opts.source.kind === "prf" ? encA : null });
  return profile;
}

// New wallet: the MPC key is created with the Share Vault (Part B), Parts A and C on this device.
// A and C sign the Travel Rule ownership proof together, right here, then C is only kept encrypted
// under the new paper card.
export async function provision(opts: { clientId: string; name: string; source: KeySource; credentialId: string; onStep?: (s: string) => void }): Promise<ProvisionResult> {
  const { clientId, source, credentialId, onStep } = opts;
  const cardKey = newCardKey();
  let parts: KeyParts | null = null;
  const sealed: { encC?: EncC } = {};
  try {
    onStep?.("Creating your key in three parts with Swissquote's Share Vault (MPC)…");
    const { ticket } = await bank<{ ticket: string }>("/wallet/keygen-ticket", "POST");
    parts = await createKey(ticket, async (c, pk) => (sealed.encC = await sealPartC(c, cardKey, clientId, pk)), (n) => onStep?.(`Creating your key in three parts (round ${n} of 4)…`));
    const { address } = await addressesOf(parts.publicKey);

    onStep?.("Proving to Swissquote that this wallet is yours (Travel Rule)…");
    const { template } = await bank<{ template: string }>("/wallet/link-message");
    const hash = await personalMessageHash(template.replace("{ADDRESS}", address));
    const signature = signatureHex(await finishSignature(hash, await signLocally(parts.a, parts.c, hash), address));
    const publicKey = hexOf(parts.publicKey);
    const encA = await seal(source, "part-a", credentialId, parts.a, partAAad(clientId, publicKey));
    const bankHoldsA = source.kind === "prf";
    await bank("/wallet/link", "POST", { address, signature, backupA: bankHoldsA ? encA : null, backupMode: bankHoldsA ? "bank" : "client-file" });
    await bank("/wallet/activate", "POST");

    const { btcAddress } = await addressesOf(parts.publicKey);
    const profile: Profile = { clientId, name: opts.name, address, btcAddress, publicKey, credentialId, encA, encC: sealed.encC!, keyVersion: parts.version, createdAt: new Date().toISOString() };
    saveProfile(profile);
    return { profile, card: await cardOf(cardKey), backupFile: backupFileOf(profile) };
  } finally {
    wipe(cardKey, parts?.a, parts?.c);
  }
}
