import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { walletStatusAction } from '@/lib/actions/ssi/list.action'
import { Oid4vciClient } from './Oid4vciClient'

export const dynamic = 'force-dynamic'

interface SearchParams { context?: string }

export default async function Oid4vciPage(props: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const sp = await props.searchParams

  const status = await walletStatusAction({ walletContext: sp.context })
  const activeContext = sp.context ?? status.activeContext
  const availableContexts = Array.from(new Set([
    ...status.wallets.map(w => w.walletContext),
    activeContext,
    'default',
  ]))

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/wallet" style={{ color: '#3f6ee8', fontSize: 13 }}>← Back to wallet</Link>
      </div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>OID4VCI redeem</h1>
      <p style={{ color: '#64748b', margin: '0.25rem 0 1.25rem' }}>
        Paste a credential offer URI or pre-authorized code. The credential will land in the
        wallet context you pick below — each context has its own link secret, so choose
        deliberately.
      </p>
      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1rem 1.25rem' }}>
        <Oid4vciClient availableContexts={availableContexts} activeContext={activeContext} />
      </section>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
        Offer URIs are produced by <Link href="/admin/issue" style={{ color: '#3f6ee8' }}>/admin/issue</Link>.
      </p>
    </div>
  )
}
