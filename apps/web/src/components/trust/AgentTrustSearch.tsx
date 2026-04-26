'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  prepareTrustSearch,
  completeTrustSearch,
  type TrustSearchHit,
  type TrustSearchPrepared,
} from '@/lib/actions/trust-search.action'
import { signWalletActionClient } from '@/lib/sign-wallet-action-client'

/**
 * Discover-agents panel for the hub home.
 *
 * Lists every person agent in the on-chain registry, scored by the caller's
 * trust-overlap policy (count of shared org memberships).
 *
 *   ✓ Score is computed inside ssi-wallet-mcp behind a consent-gated
 *     `MatchAgainstPublicSet` WalletAction. The caller's heldSet (on-chain
 *     memberships ∪ AnonCreds-held org credentials) never leaves the wallet
 *     process — only the score, sharedCount and evidenceCommit come back.
 *   ✓ The signed envelope binds the candidate list via `proofRequestHash`,
 *     so the public set can't be swapped under the signature.
 *   ✓ evidenceCommit is the anchor a future ZK-of-membership proof would
 *     target — hover an agent to see the commit your proof would recompute.
 */
export function AgentTrustSearch() {
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<TrustSearchHit[] | null>(null)
  const [filter, setFilter] = useState('')
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'signing' | 'submitting'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function runSearch() {
    setErr(null); setInfo(null); setHits(null)
    start(async () => {
      try {
        setPhase('preparing')
        const prep: TrustSearchPrepared = await prepareTrustSearch({ limit: 200 })

        if (prep.status === 'no-wallet') {
          setInfo(prep.message ?? 'No holder wallet provisioned yet.')
          setHits([])
          setPhase('idle')
          return
        }
        if (prep.status === 'no-resolver') {
          setErr(prep.message ?? 'On-chain resolver not configured.')
          setPhase('idle')
          return
        }
        if (prep.status === 'no-candidates') {
          setInfo(prep.message ?? 'No agents to score.')
          setHits([])
          setPhase('idle')
          return
        }

        if (!prep.action || !prep.hash || !prep.body || !prep.signerAddress
            || !prep.signerKind || !prep.chainId || !prep.verifyingContract || !prep.agentMeta) {
          setErr('prepare returned incomplete envelope')
          setPhase('idle')
          return
        }

        setPhase('signing')
        const signature = await signWalletActionClient(
          prep.action,
          prep.hash,
          {
            kind: prep.signerKind,
            chainId: prep.chainId,
            verifyingContract: prep.verifyingContract,
            signerAddress: prep.signerAddress,
            walletAddress: prep.walletAddress ?? null,
          },
        )

        setPhase('submitting')
        const res = await completeTrustSearch({
          action: prep.action,
          signature,
          body: prep.body,
          agentMeta: prep.agentMeta,
        })
        if (res.error) { setErr(res.error); setHits([]); setPhase('idle'); return }
        setHits(res.hits)
        setPhase('idle')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'trust search failed')
        setPhase('idle')
      }
    })
  }

  function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (!hits) runSearch()
  }

  const filtered = useMemo(() => {
    if (!hits) return null
    const q = filter.trim().toLowerCase()
    if (!q) return hits
    return hits.filter(h =>
      h.displayName.toLowerCase().includes(q)
      || (h.primaryName ?? '').toLowerCase().includes(q)
      || h.address.toLowerCase().includes(q),
    )
  }, [hits, filter])

  useEffect(() => { /* gate-on-click; no auto load */ }, [])

  return (
    <div style={{
      background: '#fff', border: '1px solid #ece6db', borderRadius: 12,
      padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{
          fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e',
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
        }}>Discover Agents</h2>
        <button
          type="button"
          onClick={toggle}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none',
            color: '#3f6ee8', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', padding: '0.25rem 0',
          }}
          data-testid="trust-search-toggle"
        >
          <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
          {open ? 'Hide' : 'Search by trust'}
        </button>
      </div>

      {open && (
        <div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name, .agent name, or address…"
            style={{
              width: '100%', padding: '0.5rem 0.7rem',
              border: '1px solid #cbd5e1', borderRadius: 8,
              fontSize: 13, marginBottom: 10,
            }}
            data-testid="trust-search-filter"
          />

          {(pending || phase !== 'idle') && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {phase === 'preparing' && 'Building candidate set…'}
              {phase === 'signing' && 'Awaiting signature (wallet/passkey)…'}
              {phase === 'submitting' && 'Scoring inside ssi-wallet-mcp…'}
            </div>
          )}
          {err && (
            <div role="alert" style={{
              padding: '0.5rem 0.7rem', background: '#fef2f2',
              border: '1px solid #fecaca', color: '#b91c1c',
              borderRadius: 8, fontSize: 12,
            }}>{err}</div>
          )}
          {info && (
            <div style={{
              padding: '0.5rem 0.7rem', background: '#fef9c3',
              border: '1px solid #fde68a', color: '#92400e',
              borderRadius: 8, fontSize: 12,
            }}>{info}</div>
          )}

          {!pending && !err && filtered && filtered.length === 0 && !info && (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              No agents match. Score above zero requires shared org memberships —
              join more orgs (or get anonymous credentials) to grow your overlap.
            </div>
          )}

          {!pending && !err && filtered && filtered.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(h => (
                <Link
                  key={h.address}
                  href={`/agents/${h.address}`}
                  title={`evidenceCommit ${h.evidenceCommit}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '0.55rem 0.7rem',
                    border: '1px solid #e5e7eb', borderRadius: 8,
                    background: h.score > 0 ? '#f5f8ff' : '#fafbfc',
                    textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <ScoreBadge score={h.score} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#171c28' }}>
                      {h.displayName}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 8 }}>
                      {h.primaryName && (
                        <code style={{ fontFamily: 'ui-monospace, monospace' }}>{h.primaryName}</code>
                      )}
                      <span>{h.sharedCount} shared</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 10, color: '#94a3b8' }}>
            Score policy: <code>smart-agent.trust-overlap.v1</code>. Hover an agent to
            see the evidenceCommit your future ZK-of-membership proof would target.
            <button
              type="button"
              onClick={runSearch}
              disabled={pending}
              style={{
                marginLeft: 8, background: 'transparent', border: 'none',
                color: '#3f6ee8', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {pending ? 'rerunning…' : '↻ rerun'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 3 ? '#15803d' : score > 0 ? '#1e40af' : '#94a3b8'
  const bg    = score >= 3 ? '#dcfce7' : score > 0 ? '#dbeafe' : '#f1f5f9'
  return (
    <span style={{
      width: 36, height: 36, borderRadius: 999,
      background: bg, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 14, flexShrink: 0,
    }}>
      {score}
    </span>
  )
}
