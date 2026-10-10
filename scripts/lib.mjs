// Shared by the recovery scripts. ABIs and typed data match app/src/recovery.ts.

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress, toHex } from 'viem'
import { baseSepolia } from 'viem/chains'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FACTORY = '0xba5ed110efdba3d005bfc882d75358acbbb85842'
export const MODULE = getAddress('0x1F039424e76238D89FC2EC7A1061F19AABf89d98')
export const CLIENT_ID = '2162953'

export const moduleAbi = [
  { type: 'function', name: 'setGuardians', stateMutability: 'nonpayable', inputs: [{ name: 'guardians', type: 'address[]' }, { name: 'threshold', type: 'uint8' }, { name: 'delay', type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'cancelRecovery', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'startRecovery', stateMutability: 'nonpayable', inputs: [{ name: 'account', type: 'address' }, { name: 'x', type: 'bytes32' }, { name: 'y', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }, { name: 'signers', type: 'address[]' }, { name: 'signatures', type: 'bytes[]' }], outputs: [] },
  { type: 'function', name: 'executeRecovery', stateMutability: 'nonpayable', inputs: [{ name: 'account', type: 'address' }], outputs: [] },
  { type: 'function', name: 'getConfig', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'guardians', type: 'address[]' }, { name: 'threshold', type: 'uint8' }, { name: 'delay', type: 'uint32' }, { name: 'nonce', type: 'uint64' }] },
  { type: 'function', name: 'pending', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'x', type: 'bytes32' }, { name: 'y', type: 'bytes32' }, { name: 'executeAfter', type: 'uint64' }] },
  { type: 'function', name: 'isEnabled', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
]

export const walletAbi = [
  { type: 'function', name: 'addOwnerAddress', stateMutability: 'nonpayable', inputs: [{ name: 'owner', type: 'address' }], outputs: [] },
  { type: 'function', name: 'execute', stateMutability: 'payable', inputs: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'isOwnerAddress', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isOwnerPublicKey', stateMutability: 'view', inputs: [{ name: 'x', type: 'bytes32' }, { name: 'y', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
]

export const factoryAbi = [
  { type: 'function', name: 'createAccount', stateMutability: 'payable', inputs: [{ name: 'owners', type: 'bytes[]' }, { name: 'nonce', type: 'uint256' }], outputs: [{ type: 'address' }] },
]

export const typedData = (r) => ({
  domain: { name: 'Swissquote Wallet Recovery', version: '1', chainId: baseSepolia.id, verifyingContract: MODULE },
  types: { Recovery: [{ name: 'account', type: 'address' }, { name: 'x', type: 'bytes32' }, { name: 'y', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
  primaryType: 'Recovery',
  message: { ...r, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) },
})

export const sortAddresses = (list) => [...list].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
export const sortApprovals = (list) => [...list].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1))

export function ownershipMessage(account) {
  return ['Swissquote Wallet ownership proof', `Client: ${CLIENT_ID}`, `Wallet: ${account}`, `Chain: ${baseSepolia.id}`, `Issued: ${new Date().toISOString()}`].join('\n')
}

/** A P-256 public key like the one a real passkey would produce. */
export async function newPasskeyPublicKey() {
  const { publicKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
  return { x: toHex(raw.slice(1, 33)), y: toHex(raw.slice(33, 65)) }
}

/** Starts the MOCK guardian service with throwaway storage. Returns its URL and a helper to call it. */
export async function startGuardian({ port, rpcUrl, children }) {
  const url = `http://127.0.0.1:${port}`
  children.push(
    spawn('node', ['server.mjs'], {
      cwd: join(ROOT, 'backend/guardian'),
      env: { ...process.env, PORT: String(port), RPC_URL: rpcUrl, RECOVERY_MODULE: MODULE, DATA_DIR: mkdtempSync(join(tmpdir(), 'guardian-')) },
      stdio: 'ignore',
    }),
  )
  await waitFor(`${url}/guardian`)
  const post = async (path, body) => {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  const { address } = await (await fetch(`${url}/guardian`)).json()
  return { url, post, address }
}

export async function waitFor(url, init) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url, init)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error(`${url} did not start`)
}

export function reporter() {
  let failed = false
  return {
    step: (text) => console.log(`\n▶ ${text}`),
    ok: (text) => console.log(`  ✓ ${text}`),
    check(condition, text) {
      if (!condition) failed = true
      console.log(`  ${condition ? '✓' : '✗'} ${text}`)
    },
    fail: () => (failed = true),
    get failed() {
      return failed
    },
  }
}
