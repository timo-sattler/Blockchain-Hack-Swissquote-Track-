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
    <svg className="triangle" viewBox="0 0 640 540" role="img" aria-label="Three key shares; any two can sign">
      <g className="tri-edges">
        <line x1="110" y1="130" x2="530" y2="130" />
        <line x1="110" y1="130" x2="320" y2="440" />
        <line x1="530" y1="130" x2="320" y2="440" />
      </g>
      <text x="320" y="116" className="tri-edge-label" textAnchor="middle">
        Everyday payments
      </text>
      <text x="196" y="300" className="tri-edge-label" textAnchor="end">
        Without
      </text>
      <text x="196" y="326" className="tri-edge-label" textAnchor="end">
        Swissquote
      </text>
      <text x="444" y="312" className="tri-edge-label" textAnchor="start">
        Recovery
      </text>
      <g className="tri-node a">
        <circle cx="110" cy="130" r="62" />
        <text x="110" y="124" className="tri-letter">A</text>
        <text x="110" y="152" className="tri-name">Your phone</text>
      </g>
      <g className="tri-node b">
        <circle cx="530" cy="130" r="62" />
        <text x="530" y="124" className="tri-letter">B</text>
        <text x="530" y="152" className="tri-name">Swissquote</text>
      </g>
      <g className="tri-node c">
        <circle cx="320" cy="440" r="62" />
        <text x="320" y="434" className="tri-letter">C</text>
        <text x="320" y="462" className="tri-name">Recovery kit</text>
      </g>
      <text x="320" y="532" className="tri-caption">Any two sign. No corner alone can do anything.</text>
    </svg>
  )
}

const CHECKLIST: { label: string; done: (items: FeedItem[]) => boolean }[] = [
  { label: 'Create wallet', done: (i) => i.some((e) => e.type === 'wallet_created') },
  { label: 'Sign & send', done: (i) => i.some((e) => e.type === 'tx_broadcast') },
  { label: 'Works without Swissquote', done: (i) => i.some((e) => e.type === 'signing' && e.parties.includes('C') && e.parties.includes('A')) },
  { label: 'Attacker refused', done: (i) => i.some((e) => e.type === 'recovery_refused') },
  { label: 'Recovered, same address', done: (i) => i.some((e) => e.type === 'recovery_completed') },
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
      <Frame kicker="Our answer: 2-of-3 MPC" title="One key, three shares, any two sign">
        <div className="split">
          <Triangle />
          <ul className="points">
            <li>
              <b className="dot a" /> <strong>Phone (A)</strong>: Face ID unlocks it. Used for every payment.
            </li>
            <li>
              <b className="dot b" /> <strong>Swissquote (B)</strong>: co-signs and checks, never alone.
            </li>
            <li>
              <b className="dot c" /> <strong>Recovery kit (C)</strong>: the client's own encrypted backup, or a relative.
            </li>
            <li className="highlight">
              <strong>One key for every coin.</strong> The signature is plain ECDSA, so the same wallet works on Bitcoin and every
              EVM chain.
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
              Only someone with two shares: the phone share (locked behind Face ID) plus the kit, or a recovery that passes re-KYC and a
              48 h delay with alerts to every device.
            </p>
          </div>
          <div>
            <h2>Who could lock the client out?</h2>
            <p>Nobody. If Swissquote refuses or disappears, phone + kit sign without it.</p>
          </div>
          <div>
            <h2>Could Swissquote move funds?</h2>
            <p>
              <strong>Alone: no</strong>, it holds 1 of 3 shares. <strong>With a partner:</strong> only if the client picked a relative
              as guardian; the delay and alerts are the safeguard. By default the client holds the kit, so no partner exists.
            </p>
          </div>
        </div>
        <div className="limits">
          <strong>Honest limits</strong>
          <span>Recovery rules are enforced by the share holders' software, not on-chain.</span>
          <span>Old shares stay valid with each other: recovery issues a new kit, a stolen phone triggers a sweep to a new key.</span>
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
            <p>For payments to third parties the client initiates and signs. Swissquote's co-signature is an automated check the client can bypass with phone + kit, so we argue Swissquote is not the sender. To validate with counsel.</p>
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
            <p>Buy and sell, swaps and CHF on/off-ramp in the app. Premium recovery and crypto inheritance as a paid service.</p>
          </div>
          <div className="card">
            <h2>Lower cost and risk</h2>
            <p>No client keys in custody: no honeypot to hack, and no custody capital tied up for these coins.</p>
          </div>
          <div className="card">
            <h2>New clients</h2>
            <p>Crypto natives who would never hand their coins to a bank, but want a safety net.</p>
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
                <strong>Gasless:</strong> on EVM via EIP-7702 + paymaster. Swissquote sponsors verified wallets, with rate limits and only
                stablecoin transfers.
              </li>
              <li>
                <strong>Compliant dApps:</strong> the co-signer screens sanctions, simulates the transaction in plain language and asks
                for extra confirmation above CHF 1,000.
              </li>
            </ul>
          </div>
          <div className="card">
            <h2>Roadmap</h2>
            <ul className="bullets">
              <li>Solana and other Ed25519 chains with an EdDSA MPC library.</li>
              <li>On-chain recovery rules on top: Miniscript on Bitcoin, a smart account on EVM.</li>
              <li>Share B in an HSM or attested enclave; commercial MPC license; audit.</li>
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
