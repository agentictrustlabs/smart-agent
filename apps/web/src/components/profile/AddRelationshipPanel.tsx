'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  listAddressableAgentsAction,
  listRelationshipTaxonomyAction,
  addRelationshipAction,
  type AddrAgent,
  type RelationshipTaxonomyRow,
} from '@/lib/actions/add-relationship.action'

/**
 * Inline "Add relationship" picker for the Relationships & Data Delegations
 * pane on the home dashboard.
 *
 *   • Pick any active agent in the on-chain registry (search-filterable).
 *   • Pick a relationship type (taxonomy keys from the SDK).
 *   • Pick a role — auto-narrowed to the roles valid for the chosen type.
 *
 * Submits via addRelationshipAction → assertRelationship server action,
 * which mints a PROPOSED edge. If the caller owns both the subject and
 * the object the edge auto-confirms; otherwise the counterparty sees a
 * pending request.
 *
 * Collapsed by default — click "Add relationship" in the section
 * header to open. Closes itself on success and shows a green confirmation.
 */
export function AddRelationshipPanel() {
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<AddrAgent[] | null>(null)
  const [taxonomy, setTaxonomy] = useState<RelationshipTaxonomyRow[] | null>(null)
  const [agentFilter, setAgentFilter] = useState('')
  const [agentAddr, setAgentAddr] = useState('')
  const [relTypeKey, setRelTypeKey] = useState('')
  const [roleKey, setRoleKey] = useState('')
  const [pending, start] = useTransition()
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Lazy load — only when opened.
  useEffect(() => {
    if (!open) return
    if (agents && taxonomy) return
    start(async () => {
      const [list, tax] = await Promise.all([
        agents ? Promise.resolve(agents) : listAddressableAgentsAction(),
        taxonomy ? Promise.resolve(taxonomy) : listRelationshipTaxonomyAction(),
      ])
      setAgents(list)
      setTaxonomy(tax)
      if (!relTypeKey && tax.length > 0) {
        const first = tax[0]
        setRelTypeKey(first.key)
        if (first.roles.length > 0) setRoleKey(first.roles[0].key)
      }
    })
  }, [open, agents, taxonomy, relTypeKey])

  const filteredAgents = useMemo(() => {
    if (!agents) return []
    const q = agentFilter.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(a =>
      a.displayName.toLowerCase().includes(q)
      || (a.primaryName ?? '').toLowerCase().includes(q)
      || a.address.toLowerCase().includes(q),
    )
  }, [agents, agentFilter])

  const availableRoles = useMemo(() => {
    if (!taxonomy || !relTypeKey) return []
    return taxonomy.find(t => t.key === relTypeKey)?.roles ?? []
  }, [taxonomy, relTypeKey])

  // Keep roleKey valid for the currently-selected relationship type.
  useEffect(() => {
    if (availableRoles.length === 0) { setRoleKey(''); return }
    if (!availableRoles.find(r => r.key === roleKey)) {
      setRoleKey(availableRoles[0].key)
    }
  }, [availableRoles, roleKey])

  function add() {
    setInfo(null); setErr(null)
    if (!agentAddr) { setErr('Pick an agent'); return }
    if (!relTypeKey || !roleKey) { setErr('Pick a relationship type and role'); return }
    start(async () => {
      const r = await addRelationshipAction({
        objectAgentAddress: agentAddr,
        relationshipTypeKey: relTypeKey,
        roleKey: roleKey,
      })
      if (r.success) {
        const target = agents?.find(a => a.address.toLowerCase() === agentAddr.toLowerCase())
        const targetLabel = target ? target.displayName : agentAddr.slice(0, 8) + '…'
        setInfo(r.autoConfirmed
          ? `Linked to ${targetLabel} (auto-confirmed).`
          : `Sent request to ${targetLabel} — pending counterparty confirmation.`)
        setAgentAddr('')
      } else {
        setErr(r.error ?? 'failed')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-label-md font-semibold"
        style={{
          background: 'transparent', border: 'none',
          color: '#3f6ee8', cursor: 'pointer',
          padding: '0.25rem 0.5rem',
        }}
        data-testid="add-relationship-toggle"
      >
        + Add relationship
      </button>
    )
  }

  return (
    <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          New relationship
        </span>
        <button
          type="button"
          onClick={() => { setOpen(false); setInfo(null); setErr(null) }}
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
        >
          cancel
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          type="text"
          value={agentFilter}
          onChange={e => setAgentFilter(e.target.value)}
          placeholder="Filter agents by name, .agent name, or address…"
          style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
          data-testid="add-rel-filter"
        />

        <select
          value={agentAddr}
          onChange={e => setAgentAddr(e.target.value)}
          style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
          data-testid="add-rel-agent"
          size={Math.min(6, Math.max(3, filteredAgents.length))}
        >
          {agents === null && <option>Loading agents…</option>}
          {agents && filteredAgents.length === 0 && <option value="">No agents match</option>}
          {filteredAgents.map(a => (
            <option key={a.address} value={a.address}>
              {a.displayName}{a.primaryName ? ` · ${a.primaryName}` : ''} · {a.agentTypeLabel}
            </option>
          ))}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 6 }}>
          <select
            value={relTypeKey}
            onChange={e => setRelTypeKey(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="add-rel-type"
          >
            {taxonomy === null && <option>Loading…</option>}
            {taxonomy?.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <select
            value={roleKey}
            onChange={e => setRoleKey(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="add-rel-role"
          >
            {availableRoles.length === 0 && <option value="">no roles</option>}
            {availableRoles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button
            type="button"
            onClick={add}
            disabled={pending || !agentAddr || !relTypeKey || !roleKey}
            style={{
              padding: '0.4rem 0.8rem',
              background: '#3f6ee8', color: '#fff',
              border: 'none', borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              cursor: pending ? 'wait' : 'pointer',
              opacity: pending ? 0.5 : 1,
            }}
            data-testid="add-rel-submit"
          >
            {pending ? '…' : 'Add'}
          </button>
        </div>

        {info && <span style={{ fontSize: 11, color: '#15803d' }}>{info}</span>}
        {err && <span style={{ fontSize: 11, color: '#b91c1c' }}>{err}</span>}
      </div>
    </div>
  )
}
