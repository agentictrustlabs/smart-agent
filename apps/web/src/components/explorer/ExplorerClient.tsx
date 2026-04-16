'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import type { ExplorerNode, ExplorerRecord, ExplorerRelationship, RegistryStats } from '@/lib/actions/explorer.action'
import { CreateAgentDialog } from './CreateAgentDialog'

// ─── Colors ─────────────────────────────────────────────────────────

const C = {
  bg: '#faf8f3', card: '#ffffff', accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)', accentBorder: 'rgba(139,94,60,0.20)',
  text: '#5c4a3a', textMuted: '#9a8c7e', border: '#ece6db',
  green: '#2e7d32', blue: '#1565c0', purple: '#7b1fa2', orange: '#e65100',
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  person: { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' },
  org: { bg: '#e3f2fd', text: '#1565c0', border: '#90caf9' },
  ai: { bg: '#f3e5f5', text: '#7b1fa2', border: '#ce93d8' },
  hub: { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' },
  unknown: { bg: '#f5f5f5', text: '#616161', border: '#e0e0e0' },
}

const DEPTH_COLORS = ['#e65100', '#1565c0', '#0d9488', '#2e7d32', '#7c3aed', '#ea580c']

// ─── Types ──────────────────────────────────────────────────────────

interface TreeNode extends ExplorerNode {
  children?: TreeNode[]
  expanded?: boolean
  depth: number
}

type DetailTab = 'records' | 'subnames' | 'relationships' | 'ownership'

interface Props {
  rootNode: string
  rootChildCount: number
  initialChildren: ExplorerNode[]
  stats: RegistryStats
}

// ─── Main Component ─────────────────────────────────────────────────

export function ExplorerClient({ rootNode, rootChildCount, initialChildren, stats }: Props) {
  const [tree, setTree] = useState<TreeNode[]>(initialChildren.map(c => ({ ...c, depth: 0 })))
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('records')
  const [records, setRecords] = useState<ExplorerRecord[]>([])
  const [relationships, setRelationships] = useState<ExplorerRelationship[]>([])
  const [subnames, setSubnames] = useState<ExplorerNode[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ name: string; address: string }> | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load detail when node is selected
  useEffect(() => {
    if (!selectedNode) return
    setLoading(true)
    Promise.all([
      fetch(`/api/explorer/records?address=${selectedNode.ownerAddress}`).then(r => r.json()),
      fetch(`/api/explorer/tree?node=${selectedNode.node}`).then(r => r.json()),
      fetch(`/api/explorer/records?address=${selectedNode.ownerAddress}&type=relationships`).then(r => r.json()),
    ]).then(([recs, subs, rels]) => {
      setRecords(recs.records ?? [])
      setSubnames(subs.children ?? [])
      setRelationships(rels.relationships ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedNode?.node])

  // Toggle tree node expansion
  async function toggleExpand(node: TreeNode) {
    if (node.expanded) {
      // Collapse
      updateTree(node.node, n => ({ ...n, expanded: false }))
      return
    }
    // Expand — fetch children
    try {
      const res = await fetch(`/api/explorer/tree?node=${node.node}`)
      const data = await res.json()
      const children: TreeNode[] = (data.children ?? []).map((c: ExplorerNode) => ({
        ...c, depth: node.depth + 1,
      }))
      updateTree(node.node, n => ({ ...n, expanded: true, children }))
    } catch { /* */ }
  }

  function updateTree(nodeHash: string, updater: (n: TreeNode) => TreeNode) {
    setTree(prev => prev.map(n => updateTreeNode(n, nodeHash, updater)))
  }

  function updateTreeNode(node: TreeNode, target: string, updater: (n: TreeNode) => TreeNode): TreeNode {
    if (node.node === target) return updater(node)
    if (node.children) return { ...node, children: node.children.map(c => updateTreeNode(c, target, updater)) }
    return node
  }

  // Search
  async function handleSearch(query?: string) {
    const q = (query ?? search).trim()
    if (!q) { setSearchResults(null); setSearching(false); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/explorer/resolve?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setSearchResults(data.results ?? [])
    } catch { setSearchResults([]) }
    setSearching(false)
  }

  function handleSearchInput(value: string) {
    setSearch(value)
    if (!value.trim()) { setSearchResults(null); return }

    // Debounced auto-search after 300ms of typing
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      handleSearch(value)
    }, 300)
  }

  function selectFromSearch(address: string, name: string) {
    // Find in tree or create a temporary node
    const found = findInTree(tree, address)
    if (found) {
      setSelectedNode(found)
    } else {
      setSelectedNode({
        node: '', label: name.split('.')[0], fullName: name,
        ownerAddress: address, ownerName: name, agentType: 'unknown',
        resolverAddress: '', childCount: 0, registeredAt: 0,
        expiry: 0, isExpired: false, primaryName: name, depth: 0,
      })
    }
    setSearchResults(null)
    setSearch('')
  }

  function findInTree(nodes: TreeNode[], address: string): TreeNode | null {
    for (const n of nodes) {
      if (n.ownerAddress.toLowerCase() === address.toLowerCase()) return n
      if (n.children) {
        const found = findInTree(n.children, address)
        if (found) return found
      }
    }
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', gap: 0 }}>

      {/* ─── Search Bar ─────────────────────────────────────────── */}
      <div style={{ padding: '0.75rem 0', display: 'flex', gap: '0.5rem', position: 'relative' }}>
        <input
          value={search}
          onChange={e => handleSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search names, addresses, or DIDs..."
          style={{
            flex: 1, padding: '0.6rem 0.85rem', border: `1px solid ${C.border}`,
            borderRadius: 10, fontSize: '0.88rem', background: C.card,
            fontFamily: search.includes('.') || search.startsWith('0x') ? 'monospace' : 'inherit',
          }}
        />
        <button onClick={() => handleSearch()} style={{
          padding: '0.6rem 1.25rem', background: C.accent, color: '#fff',
          border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
        }}>
          {searching ? '...' : 'Resolve'}
        </button>
        {/* Search results dropdown */}
        {searchResults && search.trim() && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 60, zIndex: 100,
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 300, overflowY: 'auto',
          }}>
            {searching && (
              <div style={{ padding: '0.75rem', color: C.textMuted, fontSize: '0.85rem' }}>Searching...</div>
            )}
            {!searching && searchResults.length === 0 && (
              <div style={{ padding: '0.75rem', color: C.textMuted, fontSize: '0.85rem' }}>No agents match &ldquo;{search}&rdquo;</div>
            )}
            {searchResults.map((r, i) => (
              <div key={i} onClick={() => selectFromSearch(r.address, r.name)}
                style={{ padding: '0.6rem 0.85rem', cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}
                onMouseOver={e => (e.currentTarget.style.background = C.accentLight)}
                onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: C.accent, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: '0.72rem', color: C.textMuted, fontFamily: 'monospace' }}>{r.address}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Main Content (Tree + Detail) ───────────────────────── */}
      <div style={{ display: 'flex', flex: 1, gap: '0.75rem', minHeight: 0 }}>

        {/* Left: Namespace Tree */}
        <div style={{
          width: 280, flexShrink: 0, background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, overflowY: 'auto', padding: '0.75rem',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            .agent Namespace
          </div>

          {/* Root node */}
          <div style={{ marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>.agent</span>
            <span style={{ fontSize: '0.65rem', color: C.textMuted, marginLeft: '0.3rem' }}>({rootChildCount})</span>
          </div>

          {/* Tree nodes */}
          {tree.map(node => renderTreeNode(node, selectedNode, setSelectedNode, toggleExpand))}
        </div>

        {/* Right: Detail Panel */}
        <div style={{
          flex: 1, background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, overflowY: 'auto', padding: '1.25rem',
          minWidth: 0,
        }}>
          {!selectedNode ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: C.textMuted }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🌳</div>
              <p style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Select a name to explore</p>
              <p style={{ fontSize: '0.85rem', margin: 0 }}>Click any node in the tree or search for a name above.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'monospace', fontSize: '1.15rem', fontWeight: 700, color: C.accent, marginBottom: '0.25rem' }}>
                  {selectedNode.fullName || selectedNode.label + '.agent'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 600, color: C.text }}>{selectedNode.ownerName}</span>
                  {(() => { const tc = TYPE_COLORS[selectedNode.agentType] ?? TYPE_COLORS.unknown; return (
                    <span style={{ padding: '0.15rem 0.45rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 600, background: tc.bg, color: tc.text, border: `1px solid ${tc.border}`, textTransform: 'capitalize' }}>
                      {selectedNode.agentType}
                    </span>
                  )})()}
                  {selectedNode.isExpired && <span style={{ padding: '0.15rem 0.45rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 600, background: '#ffebee', color: '#c62828' }}>Expired</span>}
                  {!selectedNode.isExpired && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e7d32', display: 'inline-block' }} />}
                </div>
                <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
                  <span style={{ fontFamily: 'monospace' }}>{selectedNode.ownerAddress.slice(0, 8)}...{selectedNode.ownerAddress.slice(-6)}</span>
                  {selectedNode.registeredAt > 0 && <span style={{ marginLeft: '0.75rem' }}>Registered: {new Date(selectedNode.registeredAt * 1000).toLocaleDateString()}</span>}
                  {selectedNode.childCount > 0 && <span style={{ marginLeft: '0.75rem' }}>{selectedNode.childCount} subnames</span>}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
                <button onClick={() => setShowCreateDialog(true)} style={{
                  padding: '0.35rem 0.85rem', background: C.accent, color: '#fff',
                  border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
                }}>
                  + Create Agent
                </button>
                <Link href={`/agents/${selectedNode.ownerAddress}`} style={{
                  padding: '0.35rem 0.85rem', background: '#f0ebe3', color: C.text,
                  borderRadius: 6, fontWeight: 500, fontSize: '0.78rem', textDecoration: 'none',
                }}>
                  View Profile
                </Link>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: '0.25rem', borderBottom: `2px solid ${C.border}`, marginBottom: '1rem' }}>
                {(['records', 'subnames', 'relationships', 'ownership'] as DetailTab[]).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    padding: '0.5rem 1rem', border: 'none', borderBottom: activeTab === tab ? `2px solid ${C.accent}` : '2px solid transparent',
                    background: 'transparent', color: activeTab === tab ? C.accent : C.textMuted,
                    fontWeight: activeTab === tab ? 700 : 500, fontSize: '0.82rem', cursor: 'pointer',
                    textTransform: 'capitalize', marginBottom: '-2px',
                  }}>
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: C.textMuted }}>Loading...</div>
              ) : (
                <>
                  {activeTab === 'records' && <RecordsPanel records={records} />}
                  {activeTab === 'subnames' && <SubnamesPanel subnames={subnames} onSelect={(n) => {
                    setSelectedNode({ ...n, depth: (selectedNode?.depth ?? 0) + 1 })
                  }} />}
                  {activeTab === 'relationships' && <RelationshipsPanel relationships={relationships} />}
                  {activeTab === 'ownership' && <OwnershipPanel node={selectedNode} />}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── Stats Bar ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '1.5rem', padding: '0.5rem 0.75rem', marginTop: '0.5rem',
        fontSize: '0.72rem', color: C.textMuted, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 8,
      }}>
        <span><strong style={{ color: C.text }}>{stats.totalNames}</strong> agents registered</span>
        <span><strong style={{ color: C.green }}>{stats.personCount}</strong> people</span>
        <span><strong style={{ color: C.blue }}>{stats.orgCount}</strong> orgs</span>
        <span><strong style={{ color: C.purple }}>{stats.aiCount}</strong> AI</span>
        <span><strong style={{ color: C.orange }}>{stats.hubCount}</strong> hubs</span>
        <span><strong style={{ color: C.accent }}>{stats.rootChildren}</strong> top-level namespaces</span>
      </div>

      {/* Create Agent Dialog */}
      {showCreateDialog && selectedNode && (
        <CreateAgentDialog
          parentNode={selectedNode.node}
          parentAgentName={selectedNode.fullName || selectedNode.label + '.agent'}
          parentDisplayName={selectedNode.ownerName}
          onClose={() => setShowCreateDialog(false)}
          onCreated={() => {
            setShowCreateDialog(false)
            // Refresh the current node's children
            if (selectedNode) toggleExpand({ ...selectedNode, expanded: false } as TreeNode)
            // Re-fetch subnames
            fetch(`/api/explorer/tree?node=${selectedNode.node}`).then(r => r.json()).then(d => setSubnames(d.children ?? []))
          }}
        />
      )}
    </div>
  )
}

// ─── Tree Node Renderer ─────────────────────────────────────────────

function renderTreeNode(
  node: TreeNode,
  selectedNode: TreeNode | null,
  onSelect: (n: TreeNode) => void,
  onToggle: (n: TreeNode) => void,
): React.ReactNode {
  const tc = TYPE_COLORS[node.agentType] ?? TYPE_COLORS.unknown
  const isSelected = selectedNode?.node === node.node
  const depthColor = DEPTH_COLORS[Math.min(node.depth, DEPTH_COLORS.length - 1)]

  return (
    <div key={node.node} style={{ marginLeft: node.depth * 16 }}>
      <div
        onClick={() => onSelect(node)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.35rem',
          padding: '0.3rem 0.5rem', borderRadius: 6, cursor: 'pointer',
          background: isSelected ? C.accentLight : 'transparent',
          borderLeft: `3px solid ${isSelected ? C.accent : depthColor}`,
          marginBottom: '0.15rem',
        }}
      >
        {/* Expand toggle */}
        {node.childCount > 0 ? (
          <button onClick={e => { e.stopPropagation(); onToggle(node) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', padding: 0, width: 12, color: C.textMuted }}>
            {node.expanded ? '▼' : '▶'}
          </button>
        ) : <span style={{ width: 12 }} />}

        {/* Type dot */}
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tc.text, flexShrink: 0 }} />

        {/* Label */}
        <span style={{ fontSize: '0.78rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? C.accent : C.text, fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </span>

        {/* Child count badge */}
        {node.childCount > 0 && (
          <span style={{ fontSize: '0.6rem', color: C.textMuted, background: '#f5f5f5', padding: '0.05rem 0.3rem', borderRadius: 8 }}>
            {node.childCount}
          </span>
        )}
      </div>

      {/* Expanded children */}
      {node.expanded && node.children && node.children.map(child =>
        renderTreeNode(child, selectedNode, onSelect, onToggle)
      )}
    </div>
  )
}

// ─── Records Panel ──────────────────────────────────────────────────

function RecordsPanel({ records }: { records: ExplorerRecord[] }) {
  if (records.length === 0) return <div style={{ color: '#9a8c7e', fontSize: '0.85rem' }}>No records found.</div>

  const groupedRecords = {
    agent: records.filter(r => r.type === 'agent'),
    addr: records.filter(r => r.type === 'addr'),
    text: records.filter(r => r.type === 'text'),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {Object.entries(groupedRecords).map(([type, recs]) => recs.length > 0 && (
        <div key={type}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
            {type === 'agent' ? 'Agent Profile' : type === 'addr' ? 'Addresses' : 'Text Records'}
          </div>
          {recs.map(r => (
            <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid #f0ebe3', gap: '1rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#5c4a3a', fontWeight: 500, flexShrink: 0 }}>{r.key}</span>
              <span style={{ fontSize: '0.78rem', color: '#9a8c7e', fontFamily: r.type === 'addr' ? 'monospace' : 'inherit', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.value || '—'}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Subnames Panel ─────────────────────────────────────────────────

function SubnamesPanel({ subnames, onSelect }: { subnames: ExplorerNode[]; onSelect: (n: ExplorerNode) => void }) {
  if (subnames.length === 0) return <div style={{ color: '#9a8c7e', fontSize: '0.85rem' }}>No subnames registered.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {subnames.map(s => {
        const tc = TYPE_COLORS[s.agentType] ?? TYPE_COLORS.unknown
        return (
          <div key={s.node} onClick={() => onSelect(s)} style={{
            display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.5rem 0.65rem',
            border: `1px solid #ece6db`, borderRadius: 8, cursor: 'pointer', background: '#fff',
          }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: tc.text, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 600, color: '#8b5e3c' }}>{s.fullName || s.label}</div>
              <div style={{ fontSize: '0.72rem', color: '#9a8c7e' }}>{s.ownerName} &middot; {s.agentType}</div>
            </div>
            {s.childCount > 0 && <span style={{ fontSize: '0.65rem', color: '#9a8c7e', background: '#f5f5f5', padding: '0.1rem 0.35rem', borderRadius: 8 }}>{s.childCount} sub</span>}
          </div>
        )
      })}
    </div>
  )
}

// ─── Relationships Panel ────────────────────────────────────────────

function RelationshipsPanel({ relationships }: { relationships: ExplorerRelationship[] }) {
  if (relationships.length === 0) return <div style={{ color: '#9a8c7e', fontSize: '0.85rem' }}>No relationships found.</div>

  const outgoing = relationships.filter(r => r.direction === 'outgoing')
  const incoming = relationships.filter(r => r.direction === 'incoming')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {outgoing.length > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Outgoing ({outgoing.length})</div>
          {outgoing.map(r => <RelationshipRow key={r.edgeId} rel={r} />)}
        </div>
      )}
      {incoming.length > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Incoming ({incoming.length})</div>
          {incoming.map(r => <RelationshipRow key={r.edgeId} rel={r} />)}
        </div>
      )}
    </div>
  )
}

function RelationshipRow({ rel }: { rel: ExplorerRelationship }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px solid #f0ebe3' }}>
      <span style={{ fontSize: '0.65rem', color: rel.direction === 'outgoing' ? '#1565c0' : '#e65100', fontWeight: 600, width: 16 }}>
        {rel.direction === 'outgoing' ? '→' : '←'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#5c4a3a' }}>{rel.counterpartyName}</span>
        {rel.counterpartyAgentName && (
          <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#8b5e3c', marginLeft: '0.3rem' }}>{rel.counterpartyAgentName}</span>
        )}
      </div>
      <span style={{ fontSize: '0.65rem', color: '#9a8c7e', background: '#f5f5f5', padding: '0.1rem 0.4rem', borderRadius: 6 }}>{rel.relationshipType}</span>
      <div style={{ display: 'flex', gap: '0.15rem' }}>
        {rel.roles.map(r => (
          <span key={r} style={{ fontSize: '0.58rem', padding: '0.05rem 0.25rem', borderRadius: 4, background: '#e3f2fd', color: '#1565c0' }}>{r}</span>
        ))}
      </div>
    </div>
  )
}

// ─── Ownership Panel ────────────────────────────────────────────────

function OwnershipPanel({ node }: { node: ExplorerNode }) {
  const [allNames, setAllNames] = useState<string[]>([])
  const [loadingNames, setLoadingNames] = useState(true)
  const [aliasLabel, setAliasLabel] = useState('')
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [aliasSuccess, setAliasSuccess] = useState<string | null>(null)
  const [savingAlias, setSavingAlias] = useState(false)

  useEffect(() => {
    setLoadingNames(true)
    fetch(`/api/explorer/resolve?q=${encodeURIComponent(node.ownerAddress)}`)
      .then(r => r.json())
      .then(d => {
        const names = (d.results ?? []).map((r: { name: string }) => r.name).filter(Boolean)
        // Also include the current node's name
        if (node.fullName && !names.includes(node.fullName)) names.unshift(node.fullName)
        setAllNames(names)
        setLoadingNames(false)
      })
      .catch(() => setLoadingNames(false))
  }, [node.ownerAddress, node.fullName])

  async function handleRegisterAlias() {
    if (!aliasLabel.trim()) return
    setSavingAlias(true)
    setAliasError(null)
    setAliasSuccess(null)
    try {
      const { registerAgentAlias } = await import('@/lib/actions/create-agent-from-explorer.action')
      const result = await registerAgentAlias({
        agentAddress: node.ownerAddress,
        nameLabel: aliasLabel,
        parentNode: node.node, // register under this node's parent
        parentAgentName: node.fullName?.split('.').slice(1).join('.') || 'agent',
      })
      if (result.success) {
        setAliasSuccess(`Registered: ${result.fullName}`)
        setAliasLabel('')
        setAllNames(prev => [...prev, result.fullName!])
      } else {
        setAliasError(result.error ?? 'Failed')
      }
    } catch (e) {
      setAliasError(e instanceof Error ? e.message : 'Failed')
    }
    setSavingAlias(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* All registered names for this agent */}
      <div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
          Registered Names ({loadingNames ? '...' : allNames.length})
        </div>
        {allNames.map(name => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#8b5e3c', fontWeight: 600 }}>{name}</span>
            {name === node.primaryName && <span style={{ fontSize: '0.6rem', padding: '0.05rem 0.3rem', borderRadius: 8, background: '#e8f5e9', color: '#2e7d32', fontWeight: 600 }}>primary</span>}
          </div>
        ))}
        {!loadingNames && allNames.length === 0 && <div style={{ fontSize: '0.78rem', color: '#9a8c7e' }}>No names registered</div>}
      </div>

      {/* Register alias */}
      <div style={{ padding: '0.65rem', background: '#faf8f3', borderRadius: 8, border: '1px solid #ece6db' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#8b5e3c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Register Additional Name</div>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <input value={aliasLabel} onChange={e => setAliasLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="label" style={{ padding: '0.35rem 0.45rem', border: '1px solid #e2e4e8', borderRadius: 6, fontFamily: 'monospace', fontSize: '0.82rem', width: 120 }} />
          <button onClick={handleRegisterAlias} disabled={savingAlias || !aliasLabel.trim()}
            style={{ padding: '0.35rem 0.75rem', background: savingAlias ? '#ccc' : '#8b5e3c', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.78rem', cursor: savingAlias ? 'wait' : 'pointer' }}>
            {savingAlias ? '...' : 'Register'}
          </button>
        </div>
        {aliasError && <div style={{ fontSize: '0.72rem', color: '#c62828', marginTop: '0.25rem' }}>{aliasError}</div>}
        {aliasSuccess && <div style={{ fontSize: '0.72rem', color: '#2e7d32', marginTop: '0.25rem' }}>{aliasSuccess}</div>}
      </div>

      {/* Owner */}
      <div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Owner</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#5c4a3a' }}>{node.ownerName}</span>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#9a8c7e', marginTop: '0.15rem' }}>{node.ownerAddress}</div>
      </div>

      {/* Resolver */}
      <div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Resolver</div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#9a8c7e' }}>{node.resolverAddress || 'Not set'}</div>
      </div>

      {/* Registration */}
      <div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Registration</div>
        <div style={{ fontSize: '0.82rem', color: '#5c4a3a' }}>{node.registeredAt > 0 ? new Date(node.registeredAt * 1000).toLocaleString() : 'Unknown'}</div>
      </div>

      {node.expiry > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Expiry</div>
          <div style={{ fontSize: '0.82rem', color: node.isExpired ? '#c62828' : '#5c4a3a' }}>
            {new Date(node.expiry * 1000).toLocaleString()} {node.isExpired && '(Expired)'}
          </div>
        </div>
      )}

      {/* Node Hash */}
      <div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>Node Hash</div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#9a8c7e', wordBreak: 'break-all' }}>{node.node}</div>
      </div>

      <div style={{ marginTop: '0.5rem' }}>
        <Link href={`/agents/${node.ownerAddress}`} style={{
          display: 'inline-block', padding: '0.4rem 1rem', background: '#8b5e3c', color: '#fff',
          borderRadius: 8, fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none',
        }}>
          View Agent Profile →
        </Link>
      </div>
    </div>
  )
}
