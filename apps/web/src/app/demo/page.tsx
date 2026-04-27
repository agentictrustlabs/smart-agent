import Link from 'next/link'
import { DEMO_USER_META } from '@/lib/auth/session'
import { DemoLoginButton } from './DemoLoginButton'

/**
 * /demo — sign in as any seeded demo user.
 *
 * The hub-specific landing page (/h/[hubId]) intentionally dropped its
 * demo picker so onboarding wouldn't conflate with demo-mode log-in.
 * This page is the unified entry point: lists every demo user across
 * the three hubs (Catalyst / Mission / Global Church), shows their
 * org and role, and signs them in via /api/demo-login on click.
 *
 * After login the user lands on /dashboard, which redirects them into
 * their hub's home (the demo-login endpoint mints a session keyed on
 * `did:demo:<key>` so getCurrentUser resolves correctly).
 */

const HUB_LABELS: Record<string, { name: string; color: string; bg: string; border: string }> = {
  catalyst:        { name: 'Catalyst NoCo Network',  color: '#8b5e3c', bg: '#faf8f3', border: 'rgba(139,94,60,0.20)' },
  cil:             { name: 'Mission Collective',     color: '#2563EB', bg: '#f8fafc', border: 'rgba(37,99,235,0.20)' },
  'global-church': { name: 'Global.Church Network',  color: '#9333ea', bg: '#faf5ff', border: 'rgba(147,51,234,0.20)' },
  generic:         { name: 'Generic',                color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
}

export default function DemoLoginPage() {
  // Group users by hub for display.
  const byHub: Record<string, Array<{ key: string; name: string; org: string; role: string; email: string }>> = {}
  for (const [key, m] of Object.entries(DEMO_USER_META)) {
    const hub = m.hubId
    if (!byHub[hub]) byHub[hub] = []
    byHub[hub].push({ key, name: m.name, org: m.org, role: m.role, email: m.email })
  }
  const hubOrder: Array<keyof typeof HUB_LABELS> = ['catalyst', 'cil', 'global-church', 'generic']

  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f6f7fb 0%, #eef2f8 100%)',
      padding: '2.5rem 1.25rem',
    }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#667085', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>
            Demo mode
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: '#171c28', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Sign in as a demo user
          </h1>
          <p style={{ fontSize: 14, color: '#5d6478', maxWidth: 560, margin: '0 auto' }}>
            Each demo user is fully provisioned on chain — wallet, person agent, hub
            membership, city tag — so you can immediately exercise trust search,
            credentials, and public locations from their perspective.
          </p>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px auto 0' }}>
            <Link href="/" style={{ color: '#3f6ee8' }}>← back</Link>
          </p>
        </div>

        {hubOrder.map(hubKey => {
          const users = byHub[hubKey] ?? []
          if (users.length === 0) return null
          const meta = HUB_LABELS[hubKey]
          return (
            <section
              key={hubKey}
              id={`hub-${hubKey}`}
              style={{
                marginBottom: 20,
                background: meta.bg,
                border: `1px solid ${meta.border}`,
                borderRadius: 16,
                padding: '1rem 1.25rem',
                scrollMarginTop: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: meta.color, margin: 0 }}>
                  {meta.name}
                </h2>
                <span style={{ fontSize: 11, color: '#64748b' }}>{users.length} users</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {users.map(u => (
                  <div
                    key={u.key}
                    style={{
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: '0.7rem 0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#171c28' }}>{u.name}</div>
                      <DemoLoginButton userKey={u.key} accent={meta.color} />
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{u.org}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{u.role} · <code style={{ fontSize: 10 }}>{u.key}</code></div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
