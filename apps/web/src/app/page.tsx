import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { AuthGate } from '@/components/auth/AuthGate'
import { DemoLoginPicker } from '@/components/auth/DemoLoginPicker'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

export default function HomePage() {
  return (
    <main data-page="home">
      <AuthGate />
      <div data-component="hero">
        {/* Logo */}
        <div data-component="hero-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#8b5e3c" />
            <path d="M14 24L20 18L26 24L32 18L38 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 32L20 26L26 32L32 26L38 32" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
            <circle cx="24" cy="14" r="3" fill="white" />
          </svg>
        </div>

        <h1>Smart Agent</h1>
        <p data-component="hero-tagline">
          Intelligent organization management with AI-powered agents, delegated authority, and verifiable trust
        </p>

        {/* Feature pills */}
        <div data-component="hero-features">
          <span data-component="feature-pill">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M5 7L6.5 8.5L9 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            ERC-4337 Accounts
          </span>
          <span data-component="feature-pill">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M7 4.5V7L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            On-Chain Trust
          </span>
          <span data-component="feature-pill">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7.5L5.5 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Delegated Authority
          </span>
          <span data-component="feature-pill">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2L9 5H12L9.5 7.5L10.5 11L7 9L3.5 11L4.5 7.5L2 5H5L7 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
            AI Agents
          </span>
        </div>

        {/* Wallet connect — always available */}
        <ConnectWalletButton />

        {/* Demo communities — available in demo mode */}
        {SKIP_AUTH && (
          <>
            <div data-component="hero-divider" style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              margin: '1.5rem 0', color: '#9a8c7e', fontSize: '0.8rem',
            }}>
              <span style={{ flex: 1, height: 1, background: '#e0dbd4' }} />
              or explore a demo community
              <span style={{ flex: 1, height: 1, background: '#e0dbd4' }} />
            </div>
            <DemoLoginPicker />
          </>
        )}
      </div>
    </main>
  )
}
