// Swissquote treasury (MOCK): a funded testnet account that sends every new wallet a welcome bonus
// of test USDC plus a little ETH for gas. In production this would be Swissquote paying for its
// clients' gas (paymaster / sponsoring), not a cash gift.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, parseEther, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const RPC_URL = process.env.RPC_URL ?? 'https://sepolia.base.org'
const STARTER_USDC = process.env.STARTER_USDC ?? '20'
const STARTER_ETH = process.env.STARTER_ETH ?? '0.0005'

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

  // One transaction at a time, so nonces never collide when several people join at once.
  let queue = Promise.resolve()
  return {
    address: account.address,
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
