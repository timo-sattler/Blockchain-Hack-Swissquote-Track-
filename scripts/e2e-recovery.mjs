// End-to-end recovery test on a local fork of Base Sepolia.
//
// Starts anvil (forked), deploys RecoveryModule, starts the MOCK Swissquote guardian service against
// the fork, creates a real Coinbase Smart Wallet v1.1 and runs the full story:
//   link wallet → set guardians → attacker refused → collusion vetoed → lost phone recovered.
// A local key stands in for the passkey (browsers are needed for real passkeys); everything else is
// the same contracts, service and typed data the app uses.
//
// Needs Foundry (anvil, forge). Run: npm run e2e:recovery

import { execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, http, pad, parseEther } from 'viem'
import { toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import {
  CLIENT_ID,
  FACTORY,
  MODULE,
  ROOT,
  factoryAbi,
  moduleAbi,
  newPasskeyPublicKey,
  ownershipMessage,
  reporter,
  sortAddresses,
  sortApprovals,
  startGuardian,
  typedData,
  waitFor,
  walletAbi,
} from './lib.mjs'

const FORK_URL = process.env.RPC_URL ?? 'https://sepolia.base.org'
const RPC = 'http://127.0.0.1:8546'
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // anvil's public test key #0
const DELAY = 60

const chain = { ...baseSepolia, rpcUrls: { default: { http: [RPC] } } }
const children = []
const report = reporter()
const { step, ok, check, fail } = report

async function main() {
  step('Starting anvil fork, deploying RecoveryModule, starting the guardian service')
  children.push(spawn('anvil', ['--fork-url', FORK_URL, '--port', '8546', '--silent'], { stdio: 'inherit' }))
  await waitFor(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' })
  // Redeploying on the fork is a no-op if the module already exists there (same CREATE2 address).
  try {
    execFileSync('forge', ['script', 'script/Deploy.s.sol', '--rpc-url', RPC, '--broadcast', '--private-key', ANVIL_KEY], {
      cwd: join(ROOT, 'contracts'),
      env: { ...process.env, MIN_DELAY: String(DELAY) },
      stdio: 'ignore',
    })
  } catch {
    // Already deployed on Base Sepolia, so the fork has it.
  }
  const guardian = await startGuardian({ port: 8788, rpcUrl: RPC, children })

  const publicClient = createPublicClient({ chain, transport: http(RPC) })
  const relayer = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(ANVIL_KEY) })
  const testClient = createTestClient({ chain, mode: 'anvil', transport: http(RPC) })
  // Wait for every transaction, and fail loudly on a revert, so each step reads settled state.
  const send = async (client, params) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: await client.writeContract(params) })
    if (receipt.status !== 'success') throw new Error(`${params.functionName} reverted`)
  }
  ok(`module ${MODULE}, Swissquote guardian ${guardian.address}`)

  step('Client creates a wallet (Coinbase Smart Wallet v1.1)')
  const oldPhone = privateKeyToAccount(generatePrivateKey()) // stands in for the passkey on the lost phone
  const account = await toCoinbaseSmartAccount({ client: publicClient, owners: [oldPhone], version: '1.1' })
  await send(relayer, { address: FACTORY, abi: factoryAbi, functionName: 'createAccount', args: [[pad(oldPhone.address)], 0n] })
  check((await publicClient.getCode({ address: account.address }))?.length > 2, `wallet deployed at ${account.address}`)

  step('Client links the wallet to their Swissquote profile with a wallet signature')
  const message = ownershipMessage(account.address)
  const link = await guardian.post('/wallets/link', { account: account.address, clientId: CLIENT_ID, message, signature: await account.signMessage({ message }) })
  check(link.status === 200, 'Swissquote verified the ownership proof (ERC-1271) and linked the wallet')
  const forged = await guardian.post('/wallets/link', { account: account.address, clientId: CLIENT_ID, message, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message }) })
  check(forged.status >= 400, `a forged ownership proof is refused (${forged.body.error})`)

  step('Client sets 2-of-3 guardians: recovery kit, Swissquote, trusted contact')
  const kit = privateKeyToAccount(generatePrivateKey())
  const contact = privateKeyToAccount(generatePrivateKey())
  await testClient.impersonateAccount({ address: account.address })
  await testClient.setBalance({ address: account.address, value: parseEther('1') })
  const asWallet = createWalletClient({ chain, transport: http(RPC), account: account.address })
  await send(asWallet, { address: account.address, abi: walletAbi, functionName: 'addOwnerAddress', args: [MODULE] })
  await send(asWallet, { address: MODULE, abi: moduleAbi, functionName: 'setGuardians', args: [sortAddresses([kit.address, guardian.address, contact.address]), 2, DELAY] })
  await testClient.stopImpersonatingAccount({ address: account.address })
  // In the app the passkey signs a sponsored UserOperation; here the stand-in key sends directly.
  await testClient.setBalance({ address: oldPhone.address, value: parseEther('1') })
  check(await publicClient.readContract({ address: MODULE, abi: moduleAbi, functionName: 'isEnabled', args: [account.address] }), 'recovery enabled on-chain')

  const newPhone = await newPasskeyPublicKey()
  const request = async () => {
    const [, , , nonce] = await publicClient.readContract({ address: MODULE, abi: moduleAbi, functionName: 'getConfig', args: [account.address] })
    const block = await publicClient.getBlock()
    return { account: account.address, ...newPhone, nonce: nonce.toString(), deadline: Number(block.timestamp) + 86400 }
  }
  const start = (r, approvals) => {
    const s = sortApprovals(approvals)
    return send(relayer, { address: MODULE, abi: moduleAbi, functionName: 'startRecovery', args: [r.account, r.x, r.y, BigInt(r.deadline), s.map((a) => a.signer), s.map((a) => a.signature)] })
  }
  const swissquoteApproval = async (r) => {
    const { body } = await guardian.post('/recovery/identity', { clientId: CLIENT_ID, account: r.account, checks: { emailOtp: true, smsOtp: true, idDocument: true, faceMatch: true } })
    return (await guardian.post('/recovery/approve', { session: body.session, ...r })).body
  }
  const pendingUntil = async () => (await publicClient.readContract({ address: MODULE, abi: moduleAbi, functionName: 'pending', args: [account.address] }))[2]

  step('Attacker with the stolen phone and email tries to recover')
  let r = await request()
  const refused = await guardian.post('/recovery/identity', { clientId: CLIENT_ID, account: account.address, checks: { emailOtp: true, smsOtp: true, idDocument: false, faceMatch: false } })
  check(refused.status === 403, `Swissquote refuses: "${refused.body.error}"`)
  const noSession = await guardian.post('/recovery/approve', { session: 'stolen', ...r })
  check(noSession.status === 401, 'Swissquote will not sign without a verified identity session')
  const attacker = privateKeyToAccount(generatePrivateKey())
  try {
    const forgedSig = await attacker.signTypedData(typedData(r))
    await start(r, [{ signer: attacker.address, signature: forgedSig }, { signer: contact.address, signature: forgedSig }])
    check(false, 'contract refuses approvals the attacker forged')
  } catch {
    check(true, 'contract refuses approvals the attacker forged')
  }

  step('Swissquote and the trusted contact collude; the real client vetoes')
  r = await request()
  await start(r, [await swissquoteApproval(r), { signer: contact.address, signature: await contact.signTypedData(typedData(r)) }])
  check((await pendingUntil()) > 0n, 'recovery started, waiting period running')
  const cancel = encodeFunctionData({ abi: moduleAbi, functionName: 'cancelRecovery' })
  await send(createWalletClient({ chain, transport: http(RPC), account: oldPhone }), { address: account.address, abi: walletAbi, functionName: 'execute', args: [MODULE, 0n, cancel] })
  check((await pendingUntil()) === 0n, "client's existing key cancelled it: Swissquote + partner cannot take the wallet")

  step('Client really loses the phone: recovery kit + Swissquote (after ID check)')
  r = await request()
  await start(r, [{ signer: kit.address, signature: await kit.signTypedData(typedData(r)) }, await swissquoteApproval(r)])
  try {
    await send(relayer, { address: MODULE, abi: moduleAbi, functionName: 'executeRecovery', args: [account.address] })
    check(false, 'cannot finish before the waiting period')
  } catch {
    check(true, 'cannot finish before the waiting period')
  }
  await testClient.increaseTime({ seconds: DELAY + 1 })
  await testClient.mine({ blocks: 1 })
  await send(relayer, { address: MODULE, abi: moduleAbi, functionName: 'executeRecovery', args: [account.address] })
  const read = (functionName, args) => publicClient.readContract({ address: account.address, abi: walletAbi, functionName, args })
  check(await read('isOwnerPublicKey', [newPhone.x, newPhone.y]), "new phone's passkey now controls the wallet")
  check(!(await read('isOwnerAddress', [oldPhone.address])), 'lost phone key was removed')
  check(await read('isOwnerAddress', [MODULE]), 'recovery stays enabled for next time')
  try {
    await send(createWalletClient({ chain, transport: http(RPC), account: oldPhone }), { address: account.address, abi: walletAbi, functionName: 'execute', args: [oldPhone.address, 0n, '0x'] })
    check(false, 'the thief holding the old phone can no longer move funds')
  } catch {
    check(true, 'the thief holding the old phone can no longer move funds')
  }

  console.log(report.failed ? '\n✗ Some checks failed' : '\n✓ Recovery works end to end')
}

main()
  .catch((error) => {
    fail()
    console.error(error)
  })
  .finally(() => {
    children.forEach((child) => child.kill())
    process.exit(report.failed ? 1 : 0)
  })
