import Link from 'next/link'
import { HUB_LANDING_CONFIGS } from '@/lib/hub-routes'

export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', background: '#faf8f3', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '3rem 2rem 1.5rem', maxWidth: 600 }}>
        <div style={{ marginBottom: '1rem' }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#8b5e3c" />
            <path d="M14 24L20 18L26 24L32 18L38 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 32L20 26L26 32L32 26L38 32" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
            <circle cx="24" cy="14" r="3" fill="white" />
          </svg>
        </div>

        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#3a3028', margin: '0 0 0.5rem' }}>
          Smart Agent
        </h1>
        <p style={{ fontSize: '1rem', color: '#9a8c7e', margin: '0 0 0.5rem', lineHeight: 1.6 }}>
          Agent Smart Account Kit — ERC-4337 identity, delegated authority, and the .agent namespace for the agentic web
        </p>
      </div>

      {/* Hub selector */}
      <div style={{ maxWidth: 700, width: '100%', padding: '0 2rem 3rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem', textAlign: 'center' }}>
          Select a Hub
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          {HUB_LANDING_CONFIGS.map(hub => (
            <Link
              key={hub.slug}
              href={`/h/${hub.slug}`}
              style={{
                display: 'block',
                padding: '1.25rem', background: '#fff', border: '1px solid #ece6db',
                borderRadius: 12, textDecoration: 'none', transition: 'all 0.15s',
                borderLeft: `4px solid ${hub.color}`,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#3a3028', marginBottom: '0.35rem' }}>
                {hub.name}
              </div>
              <p style={{ fontSize: '0.78rem', color: '#9a8c7e', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                {hub.description}
              </p>
              <div style={{ fontSize: '0.7rem', color: hub.color, fontWeight: 600 }}>
                {hub.demoUsers.length} demo users →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
