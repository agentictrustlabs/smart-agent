'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  listAddressableAgentsAction,
  listRelationshipTaxonomyAction,
  addRelationshipAction,
  type AddrAgent,
  type RelationshipTaxonomyRow,
} from '@/lib/actions/add-relationship.action'

/**
 * Inline "Add relationship" form.
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
 * Always-on (matches the My Geo Claims pane behaviour). Loads agents
 * + taxonomy on mount; on success refreshes the parent server-component
 * via router.refresh() so the relationship row appears immediately
 * below the form without a full page reload.
 */
export function AddRelationshipPanel() {
  const router = useRouter()
  const [agents, setAgents] = useState<AddrAgent[] | null>(null)
  const [taxonomy, setTaxonomy] = useState<RelationshipTaxonomyRow[] | null>(null)
  const [agentFilter, setAgentFilter] = useState('')
  const [agentAddr, setAgentAddr] = useState('')
  const [relTypeKey, setRelTypeKey] = useState('')
  const [roleKey, setRoleKey] = useState('')
  const [pending, start] = useTransition()
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Initial load on mount.
  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Selected agent (for type-aware relationship-type filtering).
  const selectedAgent = useMemo(
    () => agents?.find(a => a.address === agentAddr) ?? null,
    [agents, agentAddr],
  )

  // Relationship types valid for the selected agent's kind. If no agent
  // is selected, show every type so the user can scan options before
  // committing — the type list re-narrows once they pick.
  const availableTypes = useMemo(() => {
    if (!taxonomy) return []
    if (!selectedAgent) return taxonomy
    const kind = selectedAgent.agentKind
    if (kind === 'unknown') return taxonomy
    return taxonomy.filter(t =>
      t.validObjectTypes.length === 0 || t.validObjectTypes.includes(kind as 'person' | 'org' | 'ai' | 'hub'),
    )
  }, [taxonomy, selectedAgent])

  const availableRoles = useMemo(() => {
    if (!taxonomy || !relTypeKey) return []
    return taxonomy.find(t => t.key === relTypeKey)?.roles ?? []
  }, [taxonomy, relTypeKey])

  // Keep relTypeKey valid for the currently-selected agent's kind.
  useEffect(() => {
    if (availableTypes.length === 0) return
    if (!availableTypes.find(t => t.key === relTypeKey)) {
      setRelTypeKey(availableTypes[0].key)
    }
  }, [availableTypes, relTypeKey])

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
        // Refresh the parent server component so the new edge appears
        // in the existing-relationships list rendered above/below us.
        router.refresh()
      } else {
        setErr(r.error ?? 'failed')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>
        Associate your person agent with another active agent. Pick a
        relationship type + role; the edge auto-confirms when you own
        both sides, otherwise lands as a pending request.
      </div>
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
          {taxonomy && availableTypes.length === 0 && <option value="">No types valid for this agent</option>}
          {availableTypes.map(t => (
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
  )
}
