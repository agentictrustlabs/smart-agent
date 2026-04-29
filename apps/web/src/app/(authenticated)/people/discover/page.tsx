import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { PrincipalContextChip } from '@/components/shell/PrincipalContextChip'
import { NetworkChipBar } from '@/components/shell/NetworkChipBar'
import { PeopleDiscoverClient } from '@/components/people/PeopleDiscoverClient'

/**
 * /people/discover — intent-driven discovery surface (Phase 3).
 *
 * The Server Component is intentionally thin: identity guard, header,
 * chip bar, and a client island that owns the search box, intent
 * shortcuts, and result rendering. The relational-distance scoring
 * happens server-side inside `searchPeople` so the client never has to
 * know about the graph topology.
 */
export default async function PeopleDiscoverPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '1rem' }}>
      <PrincipalContextChip />

      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Discover</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 4 }}>
          Find someone you don&apos;t already know — sorted by who&apos;s
          closest in the trust graph.
        </p>
      </header>

      <NetworkChipBar />

      <PeopleDiscoverClient />
    </div>
  )
}
