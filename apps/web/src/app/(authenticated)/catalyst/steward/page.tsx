import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export default async function StewardPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Steward</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Governance, treasury, reviews, and network oversight.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.75rem' }}>
        <Link href="/treasury" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>💰</div>
          <strong style={{ fontSize: '0.95rem' }}>Treasury</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Financial oversight, revenue reports, and fund management.
          </p>
        </Link>

        <Link href="/reviews" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>✅</div>
          <strong style={{ fontSize: '0.95rem' }}>Reviews & Endorsements</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Submit and manage reviews, endorsements, and assertions.
          </p>
        </Link>

        <Link href="/network" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🌐</div>
          <strong style={{ fontSize: '0.95rem' }}>Network</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Trust graph, relationships, and network oversight.
          </p>
        </Link>

        <Link href="/settings" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⚙️</div>
          <strong style={{ fontSize: '0.95rem' }}>Governance & Settings</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Proposals, voting, team settings, and administration.
          </p>
        </Link>
      </div>
    </div>
  )
}
