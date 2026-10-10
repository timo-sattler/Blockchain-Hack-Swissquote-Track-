// Live recovery run on Base Sepolia, through the real bundler and paymaster (gas sponsored).
//
// Same story as e2e-recovery.mjs, but every step is a real UserOperation on the testnet, sent exactly
// like the app does: setup batch (add module as owner + set guardians), a vetoed collusion attempt,
// and a recovery submitted by the new phone's helper account. Local keys stand in for passkeys.
//
// Needs VITE_PAYMASTER_URL in app/.env.local (or PAYMASTER_URL). Run: npm run live:recovery

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, encodeFunctionData, http } from 'viem'
import { createBundlerClient, createPaymasterClient, toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import {
  CLIENT_ID,
  MODULE,
  ROOT,
  moduleAbi,
  newPasskeyPublicKey,
  ownershipMessage,
  reporter,
  sortAddresses,
  sortApprovals,
  startGuardian,
  typedData,
  walletAbi,
} from './lib.mjs'

const RPC = process.env.RPC_URL ?? 'https://sepolia.base.org'
const EXPLORER = 'https://sepolia.basescan.org'
const PIMLICO = process.env.PAYMASTER_URL ?? readFileSync(join(ROOT, 'app/.env.local'), 'utf8').match(/^VITE_PAYMASTER_URL=(\S+)$/m)?.[1]
if (!PIMLICO) throw new Error('Set VITE_PAYMASTER_URL in app/.env.local')

const children = []
const report = reporter()
const { step, ok, check, fail } = report

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const bundler = createBundlerClient({
  client: publicClient,
  transport: http(PIMLICO),
  paymaster: createPaymasterClient({ transport: http(PIMLICO) }),
  userOperation: {
    async estimateFeesPerGas() {
      const { fast } = await bundler.request({ method: 'pimlico_getUserOperationGasPrice', params: [] })
      return { maxFeePerGas: BigInt(fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(fast.maxPriorityFeePerGas) }
    },
  },
})

/** Sends one sponsored UserOperation and returns the transaction hash. */
async function userOp(account, calls) {
  const hash = await bundler.sendUserOperation({ account, calls })
  const { success, receipt } = await bundler.waitForUserOperationReceipt({ hash, timeout: 120_000 })
  if (!success) throw new Error('UserOperation reverted')
  // Public RPC nodes can lag a block behind the bundler: wait so the next read sees this change.
  while ((await publicClient.getBlockNumber()) <= receipt.blockNumber) await new Promise((r) => setTimeout(r, 1000))
  await new Promise((r) => setTimeout(r, 2000))
  return receipt.transactionHash
}

const call = (functionName, args) => ({ to: MODULE, data: encodeFunctionData({ abi: moduleAbi, functionName, args }) })
const pending = async (account) => publicClient.readContract({ address: MODULE, abi: moduleAbi, functionName: 'pending', args: [account] })

async function main() {
  step('Starting the MOCK Swissquote guardian service against Base Sepolia')
  const guardian = await startGuardian({ port: 8789, rpcUrl: RPC, children })
  ok(`Swissquote guardian ${guardian.address}`)

  step('Client creates a wallet and links it to their Swissquote profile')
  const oldPhone = privateKeyToAccount(generatePrivateKey()) // stands in for the passkey on the lost phone
  const wallet = await toCoinbaseSmartAccount({ client: publicClient, owners: [oldPhone], version: '1.1' })
  const message = ownershipMessage(wallet.address)
  const link = await guardian.post('/wallets/link', { account: wallet.address, clientId: CLIENT_ID, message, signature: await wallet.signMessage({ message }) })
  check(link.status === 200, `ownership proof accepted before the wallet even exists on-chain (ERC-6492): ${wallet.address}`)

  step('Setup: one sponsored UserOperation adds the module as owner and sets 2-of-3 guardians')
  const kit = privateKeyToAccount(generatePrivateKey())
  const contact = privateKeyToAccount(generatePrivateKey())
  const setupTx = await userOp(wallet, [
    { to: wallet.address, data: encodeFunctionData({ abi: walletAbi, functionName: 'addOwnerAddress', args: [MODULE] }) },
    call('setGuardians', [sortAddresses([kit.address, guardian.address, contact.address]), 2, 60]),
  ])
  check(await publicClient.readContract({ address: MODULE, abi: moduleAbi, functionName: 'isEnabled', args: [wallet.address] }), `recovery enabled · ${EXPLORER}/tx/${setupTx}`)

  // The new phone: a new passkey, and a helper account (owned by it in the app) that pays nothing thanks to the paymaster.
  const newPhone = await newPasskeyPublicKey()
  const helper = await toCoinbaseSmartAccount({ client: publicClient, owners: [privateKeyToAccount(generatePrivateKey())], version: '1.1' })
  const request = async () => {
    const [, , , nonce] = await publicClient.readContract({ address: MODULE, abi: moduleAbi, functionName: 'getConfig', args: [wallet.address] })
    return { account: wallet.address, ...newPhone, nonce: nonce.toString(), deadline: Math.floor(Date.now() / 1000) + 86400 }
  }
  const startCall = (r, approvals) => {
    const s = sortApprovals(approvals)
    return call('startRecovery', [r.account, r.x, r.y, BigInt(r.deadline), s.map((a) => a.signer), s.map((a) => a.signature)])
  }
  const swissquoteApproval = async (r) => {
    const { body } = await guardian.post('/recovery/identity', { clientId: CLIENT_ID, account: r.account, checks: { emailOtp: true, smsOtp: true, idDocument: true, faceMatch: true } })
    return (await guardian.post('/recovery/approve', { session: body.session, ...r })).body
  }

  step('Attacker with the stolen phone and email asks Swissquote')
  const refused = await guardian.post('/recovery/identity', { clientId: CLIENT_ID, account: wallet.address, checks: { emailOtp: true, smsOtp: true, idDocument: false, faceMatch: false } })
  check(refused.status === 403, `refused: "${refused.body.error}"`)

  step('Swissquote + trusted contact collude; the client cancels from their phone')
  let r = await request()
  const collusionTx = await userOp(helper, [startCall(r, [await swissquoteApproval(r), { signer: contact.address, signature: await contact.signTypedData(typedData(r)) }])])
  check((await pending(wallet.address))[2] > 0n, `recovery started · ${EXPLORER}/tx/${collusionTx}`)
  const cancelTx = await userOp(wallet, [call('cancelRecovery', [])])
  check((await pending(wallet.address))[2] === 0n, `client vetoed it · ${EXPLORER}/tx/${cancelTx}`)

  step('Client loses the phone: recovery kit + Swissquote, submitted from the new phone')
  r = await request()
  const startTx = await userOp(helper, [startCall(r, [{ signer: kit.address, signature: await kit.signTypedData(typedData(r)) }, await swissquoteApproval(r)])])
  const executeAfter = (await pending(wallet.address))[2]
  check(executeAfter > 0n, `recovery started, waiting period running · ${EXPLORER}/tx/${startTx}`)
  process.stdout.write('  … waiting for the 60 s waiting period')
  while ((await publicClient.getBlock()).timestamp < executeAfter) {
    process.stdout.write('.')
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  console.log()
  const executeTx = await userOp(helper, [call('executeRecovery', [wallet.address])])
  const read = (functionName, args) => publicClient.readContract({ address: wallet.address, abi: walletAbi, functionName, args })
  check(await read('isOwnerPublicKey', [newPhone.x, newPhone.y]), `new phone's passkey controls the wallet · ${EXPLORER}/tx/${executeTx}`)
  check(!(await read('isOwnerAddress', [oldPhone.address])), 'lost phone key removed')
  ok(`all gas paid by the paymaster: wallet and helper hold ${await publicClient.getBalance({ address: wallet.address })} / ${await publicClient.getBalance({ address: helper.address })} wei`)

  console.log(report.failed ? '\n✗ Some checks failed' : `\n✓ Live recovery works on Base Sepolia · ${EXPLORER}/address/${wallet.address}`)
}

main()
  .catch((error) => {
    fail()
    console.error(error.shortMessage ?? error.message, error.details ?? '')
  })
  .finally(() => {
    children.forEach((child) => child.kill())
    process.exit(report.failed ? 1 : 0)
  })
