import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { walletStatusAction } from '@/lib/actions/ssi/list.action'
import {
  ProvisionButton,
  AcceptMembershipButton,
  AcceptGuardianButton,
  RotateLinkSecretButton,
  ContextPicker,
} from './WalletActions'

export const dynamic = 'force-dynamic'

const C = {
  bg: '#f8fafc', card: '#ffffff', border: '#e2e8f0',
  text: '#1e293b', muted: '#64748b', accent: '#3f6ee8',
  okBg: 'rgba(46,125,50,0.08)', okFg: '#2e7d32',
  warnBg: 'rgba(198,93,75,0.08)', warnFg: '#c65d4b',
}

interface SearchParams { context?: string }

export default async function WalletPage(props: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const sp = await props.searchParams
  const requestedContext = sp.context

  const status = await walletStatusAction({ walletContext: requestedContext })
  const activeContextRow = status.wallets.find(w => w.walletContext === status.activeContext) ?? null
  const provisioned = !!activeContextRow

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '1.5rem', background: C.bg, minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: C.text, margin: 0 }}>Credential wallet</h1>
      <p style={{ color: C.muted, margin: '0.25rem 0 0.75rem' }}>
        Context-scoped holder wallets for {user.name} · {user.email ?? 'demo user'}
      </p>

      <ContextPicker wallets={status.wallets} activeContext={status.activeContext} />

      {status.error && (
        <div style={{ background: C.warnBg, color: C.warnFg, padding: '0.75rem 1rem', borderRadius: 10, marginBottom: 16 }}>
          {status.error}
        </div>
      )}

      <Section title={`Wallet status — "${status.activeContext}"`}>
        {provisioned && activeContextRow ? (
          <div style={{ color: C.okFg, background: C.okBg, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 14 }}>
            ✓ Holder wallet provisioned for context <b>{status.activeContext}</b>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
              principal <code>{status.principal}</code> · wallet <code>{activeContextRow.holderWalletRef}</code>
            </div>
            <div style={{ marginTop: 10 }}>
              <RotateLinkSecretButton walletContext={status.activeContext} />
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: C.muted, marginBottom: 8, fontSize: 14 }}>
              No wallet for context <b>{status.activeContext}</b> yet. Provision one — a fresh link secret + its own encrypted Askar profile.
            </div>
            <ProvisionButton walletContext={status.activeContext} />
          </div>
        )}
      </Section>

      <Section title="Accept credentials into this context">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <AcceptMembershipButton walletContext={status.activeContext} />
          <AcceptGuardianButton   walletContext={status.activeContext} />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
          For custom attributes or OID4VCI offer URIs, see{' '}
          <Link href="/admin/issue" style={{ color: C.accent }}>/admin/issue</Link>{' '}
          and <Link href="/wallet/oid4vci" style={{ color: C.accent }}>/wallet/oid4vci</Link>.
        </div>
      </Section>

      <Section title={`Credentials in "${status.activeContext}" (${status.credentials.length})`}>
        {status.credentials.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>No credentials in this context.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.muted, fontWeight: 500 }}>
                <th style={th}>Type</th>
                <th style={th}>Issuer</th>
                <th style={th}>Status</th>
                <th style={th}>Anchor</th>
                <th style={th}>Received</th>
              </tr>
            </thead>
            <tbody>
              {status.credentials.map(c => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td}>{c.credentialType}</td>
                  <td style={td}><code style={{ fontSize: 11 }}>{c.issuerId}</code></td>
                  <td style={td}><Badge ok={c.status === 'active'}>{c.status}</Badge></td>
                  <td style={td}>
                    {c.anchored === null
                      ? <span style={{ color: C.muted }}>—</span>
                      : <Badge ok={c.anchored}>{c.anchored ? 'anchored ✓' : 'not anchored'}</Badge>}
                  </td>
                  <td style={td}>{new Date(c.receivedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Proof audit — all contexts (${status.audit.length})`}>
        {status.audit.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>No presentations yet. Try <Link href="/verify/coach" style={{ color: C.accent }}>/verify/coach</Link>.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {status.audit.map(a => (
              <li key={a.id} style={{ padding: '0.5rem 0', borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Badge ok={a.result === 'ok'}>{a.result}</Badge>{' '}
                    <span style={{ color: C.muted }}>{a.purpose}</span>{' '}
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999,
                                    background: C.warnBg, color: C.warnFg }}>{a.walletContext}</span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 11 }}>{new Date(a.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ marginTop: 4, color: C.muted, fontSize: 11 }}>
                  reveal={a.revealedAttrs} · pred={a.predicates}
                  {a.pairwiseHandle && <> · pairwise=<code>{a.pairwiseHandle.slice(0, 18)}…</code></>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <Link href="/verify/coach" style={btnLink}>Coach verifier →</Link>
        <Link href="/admin/issue" style={btnLink}>Issuer admin →</Link>
        <Link href="/wallet/oid4vci" style={btnLink}>OID4VCI redeem →</Link>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '1rem 1.25rem', marginBottom: 14,
    }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: C.muted, textTransform: 'uppercase',
        letterSpacing: '0.05em', margin: '0 0 0.75rem' }}>{title}</h2>
      {children}
    </section>
  )
}
function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: ok ? C.okBg : C.warnBg, color: ok ? C.okFg : C.warnFg,
      fontSize: 11, fontWeight: 600,
    }}>{children}</span>
  )
}
const th = { padding: '0.4rem 0.5rem 0.4rem 0' }
const td = { padding: '0.5rem 0.5rem 0.5rem 0', color: C.text }
const btnLink = {
  padding: '0.5rem 0.9rem', border: `1px solid ${C.border}`, borderRadius: 8,
  background: C.card, color: C.accent, textDecoration: 'none', fontSize: 13,
}
