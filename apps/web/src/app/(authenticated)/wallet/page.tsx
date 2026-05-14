import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatUnits } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getPublicClient } from '@/lib/contracts'
import { readUsdcBalance } from '@/lib/treasury/provision'
import { walletStatusAction } from '@/lib/actions/ssi/list.action'
import {
  ProvisionButton,
  AcceptMembershipButton,
  AcceptGuardianButton,
  RotateLinkSecretButton,
  ContextPicker,
} from './WalletActions'
import type { Address } from 'viem'

export const dynamic = 'force-dynamic'

// Warm-tan palette matching the rest of the hub UI.
const C = {
  bg: '#fafaf6',
  card: '#ffffff',
  cardHero: 'linear-gradient(135deg, #ffffff 0%, #faf6ef 100%)',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  accentSoft: 'rgba(139,94,60,0.08)',
  good: '#0f766e',
  goodSoft: 'rgba(15,118,110,0.08)',
  warn: '#92400e',
  warnSoft: 'rgba(217,119,6,0.08)',
}

function shortAddr(a?: string | null): string {
  if (!a) return '—'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function formatUsd(n: bigint): string {
  const dollars = Number(n) / 1_000_000
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`
  if (dollars >= 1_000) return `$${Math.round(dollars).toLocaleString()}`
  return `$${dollars.toFixed(2)}`
}

interface SearchParams { context?: string }

export default async function WalletPage(props: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const sp = await props.searchParams
  const requestedContext = sp.context

  // ── Treasury + chain reads (parallel) ────────────────────────────
  const pub = getPublicClient()
  const smartAccount = (user.smartAccountAddress ?? user.id) as Address
  const [personAgent, usdc, smartAcctEth] = await Promise.all([
    getPersonAgentForUser(user.id).catch(() => null),
    readUsdcBalance(smartAccount).catch(() => ({ balance: 0n, tokenAddress: null, treasury: smartAccount })),
    pub.getBalance({ address: smartAccount }).catch(() => 0n),
  ])
  const treasuryEth = usdc.treasury.toLowerCase() === smartAccount.toLowerCase()
    ? smartAcctEth
    : await pub.getBalance({ address: usdc.treasury }).catch(() => 0n)
  const treasuryIsSelf = usdc.treasury.toLowerCase() === smartAccount.toLowerCase()

  // ── AnonCreds via SSI MCP (existing) ─────────────────────────────
  const status = await walletStatusAction({ walletContext: requestedContext })
  const activeContextRow = status.wallets.find(w => w.walletContext === status.activeContext) ?? null
  const provisioned = !!activeContextRow
  const credCount = status.credentials.length
  const activeCredCount = status.credentials.filter(c => c.status === 'active').length

  // ── Delegations — best-effort. Only `list_received_delegations` is
  // implemented today; issued delegations are tracked on chain via
  // DelegationManager events (not yet aggregated here).
  let receivedCount: number | null = null
  try {
    const { callMcp } = await import('@/lib/clients/mcp-client')
    const received = await callMcp<{ delegations: unknown[] }>('person', 'list_received_delegations', {}).catch(() => null)
    if (received) receivedCount = received.delegations?.length ?? 0
  } catch { /* fall through to null */ }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.5rem', background: C.bg, minHeight: '100vh' }}>
      {/* ── Profile header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Wallet
        </div>
        <h1 style={{ fontSize: '1.55rem', fontWeight: 700, color: C.text, margin: '0.15rem 0 0.3rem' }}>
          {user.name}
        </h1>
        <div style={{ fontSize: '0.8rem', color: C.textMuted, display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
          <span>Smart account <code style={{ color: C.text }}>{shortAddr(smartAccount)}</code></span>
          {personAgent && personAgent.toLowerCase() !== smartAccount.toLowerCase() && (
            <span>Person agent <code style={{ color: C.text }}>{shortAddr(personAgent)}</code></span>
          )}
          {user.email && <span>· {user.email}</span>}
        </div>
      </div>

      {/* ── Treasury hero card ─────────────────────────────────────── */}
      <section
        data-component="treasury-hero"
        style={{
          background: C.cardHero,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '1.4rem 1.6rem',
          marginBottom: '1rem',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: '1.5rem',
        }}
      >
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>
            Treasury wallet
          </div>
          <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.55rem' }}>
            {treasuryIsSelf
              ? 'Treasury share is the same as your smart account (no separate treasury deployed yet).'
              : 'A dedicated Treasury Service Agent custodies your USDC — money never sits on your smart account.'}
          </div>
          <div style={{ display: 'flex', gap: '1.85rem', alignItems: 'baseline', flexWrap: 'wrap', marginTop: '0.4rem' }}>
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.15rem' }}>
                USDC balance
              </div>
              <div data-component="treasury-usdc" style={{ fontSize: '1.95rem', fontWeight: 700, color: C.good, lineHeight: 1.1 }}>
                {formatUsd(usdc.balance)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.15rem' }}>
                ETH for gas
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: C.text }}>
                {Number(formatUnits(treasuryEth, 18)).toFixed(3)} ETH
              </div>
            </div>
          </div>
          <div style={{ fontSize: '0.73rem', color: C.textMuted, marginTop: '0.85rem' }}>
            Address <code style={{ color: C.text, fontSize: '0.8rem' }}>{usdc.treasury}</code>
          </div>
        </div>
        <div style={{
          width: 64, height: 64, borderRadius: 14, background: C.goodSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, color: C.good,
        }}>
          💰
        </div>
      </section>

      {/* ── Three-column summary: smart account · creds · delegations  */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.8rem',
        marginBottom: '1rem',
      }}>
        <SummaryCard
          label="Smart account"
          headline={`${Number(formatUnits(smartAcctEth, 18)).toFixed(3)} ETH`}
          sub={shortAddr(smartAccount)}
          icon="🔑"
        />
        <SummaryCard
          label="Credentials"
          headline={`${activeCredCount} active`}
          sub={`${credCount} total · ${status.wallets.length} contexts`}
          icon="🎓"
          href="#anoncreds"
        />
        <SummaryCard
          label="Delegations"
          headline={receivedCount === null ? '—' : `${receivedCount} received`}
          sub={receivedCount === null ? 'person-mcp unreachable' : 'On-chain DelegationManager redeems'}
          icon="🤝"
        />
      </div>

      {/* ── AnonCreds (existing UX, restyled headings) ───────────────── */}
      <h2 id="anoncreds" style={{
        fontSize: '0.7rem', fontWeight: 700, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        margin: '1.6rem 0 0.55rem',
      }}>
        AnonCreds — context-scoped holder wallets
      </h2>

      <ContextPicker wallets={status.wallets} activeContext={status.activeContext} />

      {status.error && (
        <div style={{ background: C.warnSoft, color: C.warn, padding: '0.7rem 1rem', borderRadius: 10, marginTop: '0.6rem' }}>
          {status.error}
        </div>
      )}

      <Section title={`Wallet status — "${status.activeContext}"`}>
        {provisioned && activeContextRow ? (
          <div style={{ color: C.good, background: C.goodSoft, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 14 }}>
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
            <div style={{ color: C.textMuted, marginBottom: 8, fontSize: 14 }}>
              No wallet for context <b>{status.activeContext}</b> yet. Provision one — a fresh link secret + its own encrypted Askar profile.
            </div>
            <ProvisionButton walletContext={status.activeContext} />
          </div>
        )}
      </Section>

      <Section title="Accept credentials into this context">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <AcceptMembershipButton walletContext={status.activeContext} />
          <AcceptGuardianButton walletContext={status.activeContext} />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted }}>
          For custom attributes or OID4VCI offer URIs, see{' '}
          <Link href="/admin/issue" style={{ color: C.accent }}>/admin/issue</Link>{' '}
          and <Link href="/wallet/oid4vci" style={{ color: C.accent }}>/wallet/oid4vci</Link>.
        </div>
      </Section>

      <Section title={`Credentials in "${status.activeContext}" (${status.credentials.length})`}>
        {status.credentials.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 14 }}>No credentials in this context.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.textMuted, fontWeight: 500 }}>
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
                      ? <span style={{ color: C.textMuted }}>—</span>
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
          <div style={{ color: C.textMuted, fontSize: 14 }}>No presentations yet. Try <Link href="/verify/coach" style={{ color: C.accent }}>/verify/coach</Link>.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {status.audit.slice(0, 8).map(a => (
              <li key={a.id} style={{ padding: '0.5rem 0', borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Badge ok={a.result === 'ok'}>{a.result}</Badge>{' '}
                    <span style={{ color: C.textMuted }}>{a.purpose}</span>{' '}
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999,
                                    background: C.warnSoft, color: C.warn }}>{a.walletContext}</span>
                  </div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{new Date(a.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ marginTop: 4, color: C.textMuted, fontSize: 11 }}>
                  reveal={a.revealedAttrs} · pred={a.predicates}
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

function SummaryCard({ label, headline, sub, icon, href }: {
  label: string; headline: string; sub: string; icon: string; href?: string
}) {
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {label}
        </div>
      </div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
        {headline}
      </div>
      <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.2rem' }}>
        {sub}
      </div>
    </>
  )
  const baseStyle: React.CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: '0.85rem 1rem',
    display: 'block',
    color: C.text,
    textDecoration: 'none',
  }
  return href
    ? <Link href={href} style={baseStyle}>{inner}</Link>
    : <div style={baseStyle}>{inner}</div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '0.9rem 1.15rem', marginBottom: '0.7rem',
    }}>
      <h3 style={{
        fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
        letterSpacing: '0.06em', margin: '0 0 0.55rem',
      }}>{title}</h3>
      {children}
    </section>
  )
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: ok ? C.goodSoft : C.warnSoft, color: ok ? C.good : C.warn,
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
