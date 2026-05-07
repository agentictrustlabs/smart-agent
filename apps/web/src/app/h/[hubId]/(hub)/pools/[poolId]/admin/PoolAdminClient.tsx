'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c', accentLight: 'rgba(139,94,60,0.08)',
  ok: '#0f766e', danger: '#b91c1c',
  bg: 'rgba(139,94,60,0.04)',
}

type Tab = 'mandate' | 'stewards' | 'capacity'

interface PoolView {
  id: string                                     // urn:smart-agent:pool:<slug>
  treasuryAddress: `0x${string}`
  name: string
  acceptedRestrictions: Record<string, unknown>
  acceptedUnits: string[]
  capacityCeiling: number | null
  ceilingPolicy: string
  visibility: string
  stewards: string[]
}

export function PoolAdminClient({ hubSlug, pool: initial }: { hubSlug: string; pool: PoolView }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('mandate')
  const [pool, setPool] = useState<PoolView>(initial)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  // Mandate form
  const [mandateText, setMandateText] = useState(JSON.stringify(pool.acceptedRestrictions ?? {}, null, 2))
  const [mandateUri, setMandateUri] = useState('')

  // Stewards form
  const [stewardInput, setStewardInput] = useState('')

  function saveMandate() {
    setMsg(null)
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(mandateText) }
    catch { setMsg('Mandate must be valid JSON'); return }
    start(async () => {
      const r = await fetch('/api/pool-admin/mandate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          poolAgent: pool.treasuryAddress,
          poolIRI: pool.id,
          mandate: { acceptedRestrictions: parsed, acceptedUnits: pool.acceptedUnits },
          mandateURI: mandateUri || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg(`Saved · tx ${(j.txHash as string).slice(0, 10)}…`)
      setPool((p) => ({ ...p, acceptedRestrictions: parsed }))
      router.refresh()
    })
  }

  function rotateStewards(nextList: string[]) {
    setMsg(null)
    start(async () => {
      const r = await fetch('/api/pool-admin/stewards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          poolAgent: pool.treasuryAddress,
          poolIRI: pool.id,
          stewards: nextList,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setMsg(`Failed: ${j.error ?? r.status}`); return }
      setMsg(`Saved · tx ${(j.txHash as string).slice(0, 10)}…`)
      setPool((p) => ({ ...p, stewards: nextList }))
      router.refresh()
    })
  }

  function addSteward() {
    const v = stewardInput.trim().toLowerCase()
    if (!v) return
    if (!/^0x[0-9a-f]{40}$/.test(v)) { setMsg('Steward must be a 0x-prefixed 40-char address'); return }
    if (pool.stewards.map((s) => s.toLowerCase()).includes(v)) { setMsg('Already a steward'); return }
    setStewardInput('')
    rotateStewards([...pool.stewards, v as `0x${string}`])
  }

  function removeSteward(addr: string) {
    if (pool.stewards.length <= 1) { setMsg('At least one steward required'); return }
    rotateStewards(pool.stewards.filter((s) => s.toLowerCase() !== addr.toLowerCase()))
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: `1px solid ${C.border}`, marginBottom: '1rem' }}>
        {(['mandate', 'stewards', 'capacity'] as Tab[]).map((t) => (
          <button
            key={t} type="button" onClick={() => setTab(t)}
            style={{
              padding: '0.55rem 1.05rem', background: tab === t ? C.accentLight : 'transparent',
              color: tab === t ? C.accent : C.textMuted, fontSize: '0.85rem', fontWeight: 700,
              border: 'none', borderBottom: tab === t ? `2px solid ${C.accent}` : '2px solid transparent',
              borderRadius: '6px 6px 0 0', cursor: 'pointer', textTransform: 'capitalize',
            }}>{t}</button>
        ))}
      </div>

      {tab === 'mandate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxWidth: '40rem' }}>
          <div>
            <label style={labelStyle}>Mandate (acceptedRestrictions JSON)</label>
            <textarea value={mandateText} onChange={(e) => setMandateText(e.target.value)} rows={10}
              style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: '0.78rem' }} />
            <p style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.3rem' }}>
              Hashed and committed to PoolRegistry as <code>sa:poolMandateHash</code>.
            </p>
          </div>
          <div>
            <label style={labelStyle}>Mandate URI (optional)</label>
            <input type="text" placeholder="ipfs://… or https://…" value={mandateUri}
              onChange={(e) => setMandateUri(e.target.value)} style={fieldStyle} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="button" disabled={pending} onClick={saveMandate} style={btnPrimary(pending)}>
              {pending ? 'Saving…' : 'Update mandate'}
            </button>
            {msg && <span style={{ fontSize: '0.78rem', color: C.textMuted }}>{msg}</span>}
          </div>
        </div>
      )}

      {tab === 'stewards' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxWidth: '40rem' }}>
          <div>
            <label style={labelStyle}>Current stewards ({pool.stewards.length})</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.4rem' }}>
              {pool.stewards.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: C.textMuted }}>No stewards configured.</p>
              ) : pool.stewards.map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.65rem', background: C.bg, borderRadius: 6, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  <span style={{ flex: 1, color: C.text, wordBreak: 'break-all' }}>{s}</span>
                  <button type="button" disabled={pending} onClick={() => {
                    if (confirm(`Remove ${s.slice(0, 12)}… as steward?`)) removeSteward(s)
                  }} style={btnGhost(C.danger, pending)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Add steward (0x-address)</label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input type="text" placeholder="0x…" value={stewardInput}
                onChange={(e) => setStewardInput(e.target.value)} style={{ ...fieldStyle, flex: 1, fontFamily: 'monospace' }} />
              <button type="button" disabled={pending || !stewardInput.trim()} onClick={addSteward} style={btnPrimary(pending || !stewardInput.trim())}>
                {pending ? 'Saving…' : 'Add'}
              </button>
            </div>
            <p style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.3rem' }}>
              Calls <code>PoolRegistry.rotateStewards</code> with the new full list.
            </p>
          </div>
          {msg && <span style={{ fontSize: '0.78rem', color: C.textMuted }}>{msg}</span>}
        </div>
      )}

      {tab === 'capacity' && (
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem', fontSize: '0.85rem', color: C.text, maxWidth: '36rem' }}>
          <dt style={{ color: C.textMuted }}>Capacity ceiling</dt>
          <dd>{pool.capacityCeiling != null ? pool.capacityCeiling.toLocaleString() : '—'}</dd>
          <dt style={{ color: C.textMuted }}>Ceiling policy</dt>
          <dd style={{ textTransform: 'capitalize' }}>{pool.ceilingPolicy}</dd>
          <dt style={{ color: C.textMuted }}>Visibility</dt>
          <dd style={{ textTransform: 'capitalize' }}>{pool.visibility}</dd>
          <dt style={{ color: C.textMuted }}>Accepted units</dt>
          <dd>{pool.acceptedUnits.join(', ') || '—'}</dd>
          <dt style={{ color: C.textMuted }}>Treasury</dt>
          <dd style={{ fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>{pool.treasuryAddress}</dd>
        </dl>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted,
  marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em',
}
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem',
  border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: '#fff',
}
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.55rem 1.05rem', borderRadius: 8,
    background: disabled ? '#cfc4b3' : C.accent, color: '#fff',
    border: 'none', fontSize: '0.85rem', fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
function btnGhost(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '0.4rem 0.75rem', borderRadius: 6,
    background: '#fff', color, border: `1px solid ${color}50`,
    fontSize: '0.78rem', fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
