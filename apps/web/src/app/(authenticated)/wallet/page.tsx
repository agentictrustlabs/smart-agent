import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { walletStatusAction } from '@/lib/actions/ssi/list.action'
import { ProvisionButton, AcceptMembershipButton, AcceptGuardianButton } from './WalletActions'

export const dynamic = 'force-dynamic'

const C = {
  bg: '#f8fafc', card: '#ffffff', border: '#e2e8f0',
  text: '#1e293b', muted: '#64748b', accent: '#3f6ee8',
  okBg: 'rgba(46,125,50,0.08)', okFg: '#2e7d32',
  warnBg: 'rgba(198,93,75,0.08)', warnFg: '#c65d4b',
}

export default async function WalletPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const status = await walletStatusAction()
  const provisioned = status.provisioned

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '1.5rem', background: C.bg, minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: C.text, margin: 0 }}>Credential wallet</h1>
      <p style={{ color: C.muted, margin: '0.25rem 0 1.25rem' }}>
        Holder wallet for {user.name} · {user.email ?? 'demo user'}
      </p>

      {status.error && (
        <div style={{ background: C.warnBg, color: C.warnFg, padding: '0.75rem 1rem', borderRadius: 10, marginBottom: 16 }}>
          {status.error}
        </div>
      )}

      <Section title="Wallet status">
        {provisioned ? (
          <div style={{ color: C.okFg, background: C.okBg, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 14 }}>
            ✓ Holder wallet provisioned
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
              principal <code>{status.principal}</code>
              {status.holderWalletId && <> · wallet <code>{status.holderWalletId}</code></>}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: C.muted, marginBottom: 8, fontSize: 14 }}>
              No holder wallet yet. Provision one — we&apos;ll create an encrypted vault in ssi-wallet-mcp and store your AnonCreds link secret inside.
            </div>
            <ProvisionButton />
          </div>
        )}
      </Section>

      <Section title="Accept credentials">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <AcceptMembershipButton />
          <AcceptGuardianButton />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
          For demo flows with custom attributes or the OID4VCI pre-auth flow, use{' '}
          <Link href="/admin/issue" style={{ color: C.accent }}>/admin/issue</Link> or{' '}
          <Link href="/wallet/oid4vci" style={{ color: C.accent }}>/wallet/oid4vci</Link>.
        </div>
      </Section>

      <Section title={`My credentials (${status.credentials.length})`}>
        {status.credentials.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>None yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.muted, fontWeight: 500 }}>
                <th style={th}>Type</th>
                <th style={th}>Issuer</th>
                <th style={th}>Received</th>
                <th style={th}>Status</th>
                <th style={th}>On-chain anchor</th>
              </tr>
            </thead>
            <tbody>
              {status.credentials.map(c => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td}>{c.credentialType}</td>
                  <td style={td}><code style={{ fontSize: 11 }}>{c.issuerId}</code></td>
                  <td style={td}>{new Date(c.receivedAt).toLocaleString()}</td>
                  <td style={td}><Badge ok={c.status === 'active'}>{c.status}</Badge></td>
                  <td style={td}>
                    {c.anchored === null
                      ? <span style={{ color: C.muted }}>—</span>
                      : <Badge ok={c.anchored}>{c.anchored ? 'anchored ✓' : 'not anchored'}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Proof audit (${status.audit.length})`}>
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
                    to <code style={{ fontSize: 11 }}>{a.verifierId}</code>
                  </div>
                  <div style={{ color: C.muted, fontSize: 11 }}>{new Date(a.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ marginTop: 4, color: C.muted, fontSize: 11 }}>
                  reveal={a.revealedAttrs} · pred={a.predicates} · pairwise=<code>{a.pairwiseHandle?.slice(0, 18)}…</code>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <Link href="/verify/coach" style={btnLink}>Coach verifier demo →</Link>
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
