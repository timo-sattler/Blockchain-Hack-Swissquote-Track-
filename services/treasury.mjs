// Swissquote treasury (MOCK): a funded testnet account that pays the network fee of gasless USDC/EURC
// transfers (EIP-3009 relay) and, when it holds enough, sends new wallets a small welcome bonus.
// In production: Swissquote's fee sponsoring budget.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, parseEther, parseSignature, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const RPC_URL = process.env.RPC_URL ?? 'https://sepolia.base.org'
const STARTER_USDC = process.env.STARTER_USDC ?? '20'
const STARTER_ETH = process.env.STARTER_ETH ?? '0.0005'

const transferWithAuthorizationAbi = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
]

export function createTreasury(dataDir, emit) {
  // The key lives in the share service's own storage (git-ignored), or comes from the environment.
  const keyFile = join(dataDir, 'treasury-key.json')
  let privateKey = process.env.TREASURY_PRIVATE_KEY
  if (!privateKey) {
    if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify({ privateKey: generatePrivateKey() }, null, 2))
    privateKey = JSON.parse(readFileSync(keyFile, 'utf8')).privateKey
  }
  const account = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) })

  async function balances() {
    const [eth, usdc] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    ])
    return { eth, usdc }
  }

  async function fund(wallet) {
    const usdcAmount = parseUnits(STARTER_USDC, 6)
    const ethAmount = parseEther(STARTER_ETH)
    const { eth, usdc } = await balances()
    // Keep a little ETH back for the treasury's own two transactions.
    const enoughEth = eth > ethAmount + parseEther('0.00005')
    const enoughUsdc = usdc >= usdcAmount
    if (!enoughEth) {
      console.log(`[treasury] cannot fund ${wallet.name}: treasury has only ${formatEther(eth)} ETH. Top up ${account.address}`)
      return
    }
    const ethHash = await walletClient.sendTransaction({ to: wallet.evmAddress, value: ethAmount })
    await publicClient.waitForTransactionReceipt({ hash: ethHash })
    let usdcHash = null
    if (enoughUsdc) {
      usdcHash = await walletClient.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [wallet.evmAddress, usdcAmount] })
      await publicClient.waitForTransactionReceipt({ hash: usdcHash })
    } else {
      console.log(`[treasury] only ${formatUnits(usdc, 6)} USDC left, sent gas only. Top up ${account.address}`)
    }
    emit({
      type: 'funded',
      name: wallet.name,
      to: wallet.evmAddress,
      usdc: usdcHash ? STARTER_USDC : '0',
      eth: STARTER_ETH,
      hash: usdcHash ?? ethHash,
    })
    console.log(`[treasury] funded ${wallet.name}: ${usdcHash ? STARTER_USDC : 0} USDC + ${STARTER_ETH} ETH`)
  }

  // Gasless USDC / EURC: submit the client's signed authorization; the treasury pays the network fee.
  async function relay(message, signature, token = USDC) {
    const { r, s, v, yParity } = parseSignature(signature)
    const request = {
      address: token,
      abi: transferWithAuthorizationAbi,
      functionName: 'transferWithAuthorization',
      args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, Number(v ?? 27n + BigInt(yParity)), r, s],
    }
    // Simulate first: USDC checks the signature before the balance, so a clear revert reason comes back.
    await publicClient.simulateContract({ account, ...request })
    const hash = await walletClient.writeContract(request)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`Sponsored transfer reverted on-chain: ${hash}`)
    return hash
  }

  // One transaction at a time, so nonces never collide when several people join at once.
  let queue = Promise.resolve()
  const queued = (task) => {
    const result = queue.then(task)
    queue = result.catch(() => {})
    return result
  }
  return {
    address: account.address,
    relayUsdcAuthorization(message, signature, token) {
      return queued(() => relay(message, signature, token))
    },
    enqueue(wallet) {
      queue = queue.then(() => fund(wallet)).catch((error) => console.error('[treasury] funding failed:', error.shortMessage ?? error.message))
    },
    async status() {
      const { eth, usdc } = await balances()
      return {
        address: account.address,
        eth: formatEther(eth),
        usdc: formatUnits(usdc, 6),
        starter: { usdc: STARTER_USDC, eth: STARTER_ETH },
        walletsFundable: Math.min(Math.floor(Number(formatUnits(usdc, 6)) / Number(STARTER_USDC)), Math.floor(Number(formatEther(eth)) / Number(STARTER_ETH))),
      }
    },
  }
}
