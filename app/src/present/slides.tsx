import type { ReactNode } from 'react'
import { Feed } from './Feed'
import { JoinSlide } from './JoinSlide'
import { LiveArchitecture } from './LiveArchitecture'
import { NetworkGraph } from './NetworkGraph'
import type { FeedItem, ServiceStatus } from './live'

export type Live = { items: FeedItem[]; status: ServiceStatus; shareOnline: boolean | null }
export type Slide = { id: string; title: string; render: (live: Live) => ReactNode }

const TEAM = ['Grace', 'Jeroen', 'Maxi', 'Timo', 'Vincent']

function Frame({ kicker, title, children }: { kicker: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="frame">
      <p className="kicker">{kicker}</p>
      <h1>{title}</h1>
      <div className="frame-body">{children}</div>
    </div>
  )
}

function Triangle() {
  return (
    <svg className="triangle" viewBox="0 0 640 540" role="img" aria-label="One key in two parts: both sign every payment">
      <g className="tri-edges">
        <line x1="110" y1="130" x2="530" y2="130" />
        <line x1="110" y1="192" x2="110" y2="262" />
        <line x1="110" y1="306" x2="110" y2="352" />
        <line x1="530" y1="192" x2="530" y2="378" strokeDasharray="10 10" />
      </g>
      <text x="320" y="116" className="tri-edge-label" textAnchor="middle">
        Every payment: both parts
      </text>
      <text x="508" y="262" className="tri-edge-label" textAnchor="end">
        copy of B, released only if
      </text>
      <text x="508" y="288" className="tri-edge-label" textAnchor="end">
        Swissquote is gone 6 months
      </text>
      <g className="tri-node a">
        <circle cx="110" cy="130" r="62" />
        <text x="110" y="124" className="tri-letter">A</text>
        <text x="110" y="152" className="tri-name">Your part</text>
      </g>
      <g className="tri-node a">
        <text x="110" y="292" className="tri-name">Laptop · Face ID</text>
        <text x="110" y="382" className="tri-name">Phone · identical copy</text>
      </g>
      <g className="tri-node b">
        <circle cx="530" cy="130" r="62" />
        <text x="530" y="124" className="tri-letter">B</text>
        <text x="530" y="152" className="tri-name">Swissquote</text>
      </g>
      <g className="tri-node c">
        <circle cx="530" cy="440" r="62" />
        <text x="530" y="434" className="tri-letter">⚖</text>
        <text x="530" y="462" className="tri-name">Escrow agent</text>
      </g>
      <text x="320" y="532" className="tri-caption">Neither part can sign alone. Swissquote screens every payment.</text>
    </svg>
  )
}

const CHECKLIST: { label: string; done: (items: FeedItem[]) => boolean }[] = [
  { label: 'Create wallet', done: (i) => i.some((e) => e.type === 'wallet_created') },
  { label: 'Sign & send', done: (i) => i.some((e) => e.type === 'tx_broadcast') },
  { label: 'Malicious address blocked', done: (i) => i.some((e) => e.type === 'payment_blocked') },
  { label: 'Second device added', done: (i) => i.some((e) => e.type === 'device_added') },
  { label: 'Lost device removed', done: (i) => i.some((e) => e.type === 'device_removed') },
]

export const SLIDES: Slide[] = [
  {
    id: 'title',
    title: 'Title',
    render: () => (
      <div className="title-slide">
        <img src="/favicon.svg" alt="" width="96" height="96" />
        <p className="kicker">EPFL Blockchain Hackathon 2026 · Swissquote track</p>
        <h1 className="hero">
          Your keys.
          <br />
          <span>Swissquote's safety net.</span>
        </h1>
        <p className="lead">A self-custody wallet for every coin, one tap away from the Swissquote account.</p>
        <p className="team">{TEAM.join(' · ')}</p>
      </div>
    ),
  },
  {
    id: 'problem',
    title: 'Problem',
    render: () => (
      <Frame kicker="The problem" title="Self-custody today means leaving Swissquote">
        <div className="cards three">
          <div className="card">
            <span className="card-icon">↗</span>
            <h2>Withdraw and leave</h2>
            <p>Clients who want their own keys move crypto to MetaMask or a Ledger, and leave the Swissquote ecosystem.</p>
          </div>
          <div className="card">
            <span className="card-icon">✎</span>
            <h2>Seed phrases fail</h2>
            <p>24 words on paper get lost, photographed or phished. That is not a product for a typical bank client.</p>
          </div>
          <div className="card">
            <span className="card-icon">∅</span>
            <h2>No safety net</h2>
            <p>Lose the device or the words and the money is gone. There is no hotline that can reset a private key.</p>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'solution',
    title: 'Our answer',
    render: () => (
      <Frame kicker="Our answer: two-party MPC" title="One key, two parts, both sign every payment">
        <div className="split">
          <Triangle />
          <ul className="points">
            <li>
              <b className="dot a" /> <strong>Your part (A)</strong>: on your laptop, with an identical copy on your phone. Each device unlocks it with its own Face ID.
            </li>
            <li>
              <b className="dot b" /> <strong>Swissquote (B)</strong>: needed for every payment. Blocks malicious addresses, pays the fee, never acts alone.
            </li>
            <li>
              <b className="dot c" /> <strong>Escrow agent</strong>: an independent notary with a copy of B. Only if Swissquote is gone for six months does it hand B to you.
            </li>
            <li className="highlight">
              <strong>Safer and less pricey:</strong> every payment passes Swissquote's screening, and USDC transfers are free because
              Swissquote pays the network fee.
            </li>
            <li className="highlight">
              <strong>One key for every coin.</strong> Today USDC, EURC and ETH on Base, and Bitcoin. The same key already has addresses
              on Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Litecoin, Dogecoin and Tron, with no contract to deploy.
            </li>
            <li className="muted">Threshold signatures with Silence Labs Silent Shard (DKLs23). No homemade cryptography.</li>
          </ul>
        </div>
      </Frame>
    ),
  },
  {
    id: 'architecture',
    title: 'Architecture',
    render: () => (
      <div className="frame">
        <p className="kicker">Architecture · real vs. mocked</p>
        <img className="arch-img" src="/architecture.svg" alt="Architecture diagram" />
      </div>
    ),
  },
  {
    id: 'join',
    title: 'Join the demo',
    render: ({ items }) => <JoinSlide items={items} />,
  },
  {
    id: 'network',
    title: 'Live network',
    render: ({ items }) => (
      <div className="frame live">
        <div className="live-head">
          <div>
            <p className="kicker">Live network · Base Sepolia</p>
            <h1>Who pays whom, right now</h1>
          </div>
        </div>
        <div className="live-grid">
          <div className="network-panel">
            <NetworkGraph items={items} />
          </div>
          <div className="feed-panel">
            <h2>Activity</h2>
            <Feed items={items} compact />
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'live',
    title: 'Live demo',
    render: ({ items, shareOnline }) => (
      <div className="frame live">
        <div className="live-head">
          <div>
            <p className="kicker">Live demo</p>
            <h1>Create → sign → lose → recover</h1>
          </div>
          <ul className="checklist">
            {CHECKLIST.map((step) => (
              <li key={step.label} className={step.done(items) ? 'done' : ''}>
                <span>{step.done(items) ? '✓' : '○'}</span>
                {step.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="live-grid">
          <LiveArchitecture items={items} shareOnline={shareOnline} />
          <div className="feed-panel">
            <h2>Activity</h2>
            <Feed items={items} compact />
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'threats',
    title: 'Threat model',
    render: () => (
      <Frame kicker="Security & custody" title="The three questions, answered">
        <div className="qa">
          <div>
            <h2>Who could steal funds?</h2>
            <p>
              Nobody with one part. A thief needs one of your devices and its Face ID, and still goes through Swissquote's screening. A lost
              device is removed in one tap: Swissquote then refuses its passkey.
            </p>
          </div>
          <div>
            <h2>Who could lock the client out?</h2>
            <p>Swissquote could refuse to co-sign while it operates; that is how it blocks malicious payments. If it fails or disappears, the wallet is paused and after a six-month grace period the escrow agent hands its copy of B to your device.</p>
          </div>
          <div>
            <h2>Could Swissquote move funds?</h2>
            <p>
              <strong>No.</strong> It holds one of two parts. The escrow agent holds a copy of the same part B, so Swissquote and the agent
              together still cannot sign without you.
            </p>
          </div>
        </div>
        <div className="limits">
          <strong>Honest limits</strong>
          <span>Losing every device that holds your part means losing the wallet: add a second device.</span>
          <span>While Swissquote is unreachable the wallet is paused (grace period: six months in production, seconds in the demo).</span>
          <span>The MPC library is licensed for non-commercial use; a launch needs a commercial license.</span>
        </div>
      </Frame>
    ),
  },
  {
    id: 'legal',
    title: 'Legal',
    render: () => (
      <Frame kicker="Legal feasibility" title="Software, not custody, with proven ownership">
        <div className="cards three">
          <div className="card">
            <h2>Custody or software?</h2>
            <p>Swissquote can never move funds on its own, so the wallet is software, not custody: no bank capital or segregation rules for the coins.</p>
          </div>
          <div className="card">
            <h2>Travel Rule: proven ownership</h2>
            <p>The wallet is created inside the logged-in Swissquote app and its key signs the address. The registry binds it to the client ID, so bank ↔ wallet transfers need no manual check.</p>
          </div>
          <div className="card">
            <h2>Sending institution?</h2>
            <p>Swissquote co-signs and screens every payment, so we treat it as the sending institution: it attaches originator data for transfers to other regulated providers. It still cannot move funds alone, so it is not custody. To validate with counsel.</p>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'business',
    title: 'Business case',
    render: () => (
      <Frame kicker="Business case" title="Keep the client, earn on the services">
        <div className="cards four">
          <div className="card">
            <h2>Assets stay</h2>
            <p>Self-custody happens inside the Swissquote app instead of a withdrawal to an external wallet.</p>
          </div>
          <div className="card">
            <h2>Revenue</h2>
            <p>Buy and sell, swaps and CHF on/off-ramp in the app. Premium tiers: higher free-transfer limits, more devices, family wallets.</p>
          </div>
          <div className="card">
            <h2>Lower cost and risk</h2>
            <p>No client keys in custody: no honeypot to hack, and no custody capital tied up for these coins.</p>
          </div>
          <div className="card">
            <h2>New clients</h2>
            <p>Crypto natives who would never hand their coins to a bank, but want scam protection and a Swiss counterparty.</p>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'roadmap',
    title: 'Bonus & roadmap',
    render: () => (
      <Frame kicker="Bonus topics & roadmap" title="What comes next">
        <div className="cards two">
          <div className="card">
            <h2>Bonus topics</h2>
            <ul className="bullets">
              <li>
                <strong>Gasless (built):</strong> USDC and EURC sent through Swissquote are free. The client signs an authorization
                (EIP-3009), Swissquote submits it and pays the fee, with a daily limit per wallet.
              </li>
              <li>
                <strong>Compliance (built):</strong> Swissquote blocks payments to sanctioned or scam addresses before anything is signed
                (mock list) and asks for an extra confirmation above 1,000 USDC or EURC.
              </li>
            </ul>
          </div>
          <div className="card">
            <h2>Roadmap</h2>
            <ul className="bullets">
              <li>Solana and other Ed25519 chains with an EdDSA MPC library.</li>
              <li>Your part encrypted with the passkey (WebAuthn PRF) or the phone's keychain.</li>
              <li>Swissquote's part in an HSM; escrow with a notary; commercial MPC license; audit.</li>
            </ul>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'end',
    title: 'Thank you',
    render: ({ items }) => (
      <div className="title-slide">
        <h1 className="hero">
          Your keys.
          <br />
          <span>Swissquote's safety net.</span>
        </h1>
        <p className="lead">
          {items.filter((i) => i.type === 'tx_broadcast').length} transactions and {items.filter((i) => i.type === 'wallet_created').length}{' '}
          wallets in this session.
        </p>
        <p className="team">{TEAM.join(' · ')}</p>
        <p className="muted">AI tools we used are listed in pitch/ai-tools.md</p>
      </div>
    ),
  },
]
