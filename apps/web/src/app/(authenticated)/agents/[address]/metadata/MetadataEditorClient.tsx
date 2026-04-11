'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerAgentMetadata, generateMetadataJsonLd } from '@/lib/actions/agent-metadata.action'

const AGENT_TYPES = [
  { value: 'person', label: 'Person Agent', desc: 'An agent controlled by an individual human' },
  { value: 'org', label: 'Organization', desc: 'Represents a company, DAO, or legal entity' },
  { value: 'ai', label: 'AI Agent', desc: 'An autonomous or semi-autonomous AI agent' },
]

const AI_CLASSES = [
  { value: 'discovery', label: 'Discovery', desc: 'Discovers and evaluates other agents' },
  { value: 'validator', label: 'Validator', desc: 'Validates activities and attestations' },
  { value: 'executor', label: 'Executor', desc: 'Executes delegated tasks' },
  { value: 'assistant', label: 'Assistant', desc: 'Provides assistance to humans' },
  { value: 'oracle', label: 'Oracle', desc: 'Provides external data and attestations' },
  { value: 'custom', label: 'Custom', desc: 'Custom agent type' },
]

const TRUST_MODEL_OPTIONS = [
  { value: 'reputation', label: 'Reputation', desc: 'Trust via client feedback and reviews' },
  { value: 'crypto-economic', label: 'Crypto-Economic', desc: 'Trust via staking and economic bonds' },
  { value: 'tee-attestation', label: 'TEE Attestation', desc: 'Trust via hardware-verified code execution' },
]

const COMMON_CAPABILITIES = [
  'evaluate-trust', 'submit-review', 'discover-agents', 'execute-task',
  'validate-activity', 'sign-transaction', 'manage-delegation', 'provide-data',
  'analyze-risk', 'monitor-compliance',
]

interface Props {
  agentAddress: string
  agentName: string
  chainId: number
  initial: {
    displayName: string
    description: string
    agentType: string
    aiAgentClass: string
    capabilities: string[]
    trustModels: string[]
    a2aEndpoint: string
    mcpServer: string
    isRegistered: boolean
  }
}

export function MetadataEditorClient({ agentAddress, agentName, chainId, initial }: Props) {
  const router = useRouter()
  const [displayName, setDisplayName] = useState(initial.displayName || agentName)
  const [description, setDescription] = useState(initial.description)
  const [agentType, setAgentType] = useState(initial.agentType || 'person')
  const [aiClass, setAiClass] = useState(initial.aiAgentClass || 'custom')
  const [capabilities, setCapabilities] = useState<string[]>(initial.capabilities)
  const [newCap, setNewCap] = useState('')
  const [trustModels, setTrustModels] = useState<Set<string>>(new Set(initial.trustModels))
  const [a2aEndpoint, setA2aEndpoint] = useState(initial.a2aEndpoint)
  const [mcpServer, setMcpServer] = useState(initial.mcpServer)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [jsonLd, setJsonLd] = useState<Record<string, unknown> | null>(null)
  const [activeTab, setActiveTab] = useState<'form' | 'jsonld' | 'shacl'>('form')

  function addCapability(cap: string) {
    const c = cap.trim()
    if (c && !capabilities.includes(c)) setCapabilities([...capabilities, c])
    setNewCap('')
  }

  function removeCapability(cap: string) {
    setCapabilities(capabilities.filter(c => c !== cap))
  }

  function toggleTrust(model: string) {
    setTrustModels(prev => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model); else next.add(model)
      return next
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess(false)

    const result = await registerAgentMetadata({
      agentAddress,
      displayName,
      description,
      agentType,
      aiAgentClass: agentType === 'ai' ? aiClass : undefined,
      capabilities,
      trustModels: [...trustModels],
      a2aEndpoint: a2aEndpoint || undefined,
      mcpServer: mcpServer || undefined,
    })

    setSubmitting(false)
    if (result.success) {
      setSuccess(true)
      const jld = await generateMetadataJsonLd(agentAddress)
      if (jld.success && jld.document) setJsonLd(jld.document)
    } else {
      setError(result.error ?? 'Failed to save')
    }
  }

  async function handlePreview() {
    const jld = await generateMetadataJsonLd(agentAddress)
    if (jld.success && jld.document) {
      setJsonLd(jld.document)
      setActiveTab('jsonld')
    } else {
      setError(jld.error ?? 'Failed to generate preview')
    }
  }

  // SHACL validation (client-side check against shape rules)
  function validateShacl(): Array<{ field: string; message: string; severity: 'error' | 'warning' }> {
    const issues: Array<{ field: string; message: string; severity: 'error' | 'warning' }> = []
    if (!displayName.trim()) issues.push({ field: 'displayName', message: 'Display name is required', severity: 'error' })
    if (displayName.length > 100) issues.push({ field: 'displayName', message: 'Display name must be under 100 characters', severity: 'error' })
    if (!agentType) issues.push({ field: 'agentType', message: 'Agent type is required', severity: 'error' })
    if (agentType === 'org' && !description.trim()) issues.push({ field: 'description', message: 'Organizations must have a description (SHACL: sh:minCount 1)', severity: 'error' })
    if (agentType === 'ai') {
      if (!aiClass || aiClass === 'custom') issues.push({ field: 'aiAgentClass', message: 'AI agents should declare a specific class', severity: 'warning' })
      if (trustModels.size === 0) issues.push({ field: 'trustModels', message: 'AI agents must declare at least one trust model (SHACL: sh:minCount 1)', severity: 'error' })
      if (capabilities.length === 0) issues.push({ field: 'capabilities', message: 'AI agents must declare at least one capability (SHACL: sh:minCount 1)', severity: 'error' })
    }
    if (description.length > 500) issues.push({ field: 'description', message: 'Description should be under 500 characters', severity: 'warning' })
    return issues
  }

  const shaclIssues = validateShacl()
  const hasErrors = shaclIssues.some(i => i.severity === 'error')
  const selectedTypeInfo = AGENT_TYPES.find(t => t.value === agentType)

  return (
    <div>
      {/* Tab bar */}
      <div data-component="graph-filter" style={{ marginBottom: '1rem' }}>
        <button onClick={() => setActiveTab('form')} data-component="filter-btn" data-active={activeTab === 'form' ? 'true' : 'false'}>
          Details
        </button>
        <button onClick={() => { handlePreview(); }} data-component="filter-btn" data-active={activeTab === 'jsonld' ? 'true' : 'false'}>
          Data Export
        </button>
        <button onClick={() => setActiveTab('shacl')} data-component="filter-btn" data-active={activeTab === 'shacl' ? 'true' : 'false'}>
          Validation {shaclIssues.length > 0 && `(${shaclIssues.length})`}
        </button>
      </div>

      {/* ─── Properties Tab ──────────────────────────────────────────── */}
      {activeTab === 'form' && (
        <form onSubmit={handleSave} data-component="deploy-form">

          {/* Identity Section */}
          <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
            <h3>Identity</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div data-component="form-field">
                <label htmlFor="name">Display Name *</label>
                <input id="name" value={displayName} onChange={e => setDisplayName(e.target.value)} required />
              </div>
              <div data-component="form-field">
                <label htmlFor="type">Agent Type *</label>
                <select id="type" value={agentType} onChange={e => setAgentType(e.target.value)} data-component="org-select">
                  {AGENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {selectedTypeInfo && <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>{selectedTypeInfo.desc}</p>}
              </div>
            </div>

            <div data-component="form-field">
              <label htmlFor="desc">Description {agentType === 'org' && '*'}</label>
              <textarea id="desc" value={description} onChange={e => setDescription(e.target.value)} rows={3}
                placeholder="Describe what this agent does, its purpose, and responsibilities" />
              <p style={{ fontSize: '0.7rem', color: '#555', textAlign: 'right' }}>{description.length}/500</p>
            </div>

            {agentType === 'ai' && (
              <div data-component="form-field">
                <label htmlFor="aiclass">AI Agent Class *</label>
                <select id="aiclass" value={aiClass} onChange={e => setAiClass(e.target.value)} data-component="org-select">
                  {AI_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label} — {c.desc}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Capabilities Section */}
          <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
            <h3>Capabilities {agentType === 'ai' && '*'}</h3>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              What can this agent do? Each capability is stored on-chain as a predicate value.
            </p>

            {capabilities.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.5rem' }}>
                {capabilities.map(c => (
                  <span key={c} data-component="role-badge" style={{ cursor: 'pointer' }}
                    onClick={() => removeCapability(c)} title="Click to remove">
                    {c} x
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input value={newCap} onChange={e => setNewCap(e.target.value)}
                placeholder="Add capability..."
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCapability(newCap) } }}
                style={{ flex: 1 }} />
              <button type="button" onClick={() => addCapability(newCap)}
                style={{ background: '#e5e7eb', color: '#1a1a2e', padding: '0.4rem 0.8rem', whiteSpace: 'nowrap' }}>Add</button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {COMMON_CAPABILITIES.filter(c => !capabilities.includes(c)).map(c => (
                <button key={c} type="button" onClick={() => addCapability(c)}
                  style={{ background: 'transparent', border: '1px dashed #333', color: '#666',
                    padding: '0.2rem 0.5rem', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}>
                  + {c}
                </button>
              ))}
            </div>
          </div>

          {/* Trust Models Section */}
          <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
            <h3>Supported Trust Models {agentType === 'ai' && '*'}</h3>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              How does this agent establish trust? Select all that apply.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              {TRUST_MODEL_OPTIONS.map(m => {
                const isActive = trustModels.has(m.value)
                return (
                  <button key={m.value} type="button" onClick={() => toggleTrust(m.value)}
                    style={{
                      textAlign: 'left', padding: '0.75rem 1rem', borderRadius: 6, cursor: 'pointer',
                      border: isActive ? '2px solid #2563eb' : '1px solid #e2e4e8',
                      background: isActive ? '#eff6ff' : '#ffffff',
                      color: '#1a1a2e',
                    }}>
                    <strong style={{ display: 'block', fontSize: '0.85rem' }}>{m.label}</strong>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem' }}>{m.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Service Endpoints Section */}
          <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
            <h3>Service Endpoints</h3>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              URIs where other agents and clients can reach this agent.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div data-component="form-field">
                <label htmlFor="a2a">A2A Endpoint</label>
                <input id="a2a" value={a2aEndpoint} onChange={e => setA2aEndpoint(e.target.value)}
                  placeholder="https://agent.example.com/a2a" />
                <p style={{ fontSize: '0.7rem', color: '#555' }}>Agent-to-Agent communication (A2A standard)</p>
              </div>
              <div data-component="form-field">
                <label htmlFor="mcp">MCP Server</label>
                <input id="mcp" value={mcpServer} onChange={e => setMcpServer(e.target.value)}
                  placeholder="https://agent.example.com/mcp" />
                <p style={{ fontSize: '0.7rem', color: '#555' }}>Model Context Protocol server</p>
              </div>
            </div>
          </div>

          {/* Validation warnings inline */}
          {shaclIssues.length > 0 && (
            <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', background: hasErrors ? '#fef2f2' : '#fefce8',
              border: `1px solid ${hasErrors ? '#fecaca' : '#fef08a'}`, borderRadius: 6 }}>
              {shaclIssues.map((issue, i) => (
                <p key={i} style={{ fontSize: '0.8rem', color: issue.severity === 'error' ? '#ef4444' : '#f59e0b', margin: '0.2rem 0' }}>
                  {issue.severity === 'error' ? 'Error' : 'Warning'}: {issue.message}
                </p>
              ))}
            </div>
          )}

          {error && <p role="alert" data-component="error-message">{error}</p>}
          {success && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, marginBottom: '0.5rem' }}>
              <p style={{ color: '#22c55e', fontSize: '0.9rem', margin: 0 }}>Metadata saved on-chain. Properties are now queryable by any contract or client.</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={submitting || hasErrors}>
              {submitting ? 'Saving...' : initial.isRegistered ? 'Save Changes' : 'Save Profile'}
            </button>
            <button type="button" onClick={() => router.push(`/agents/${agentAddress}`)} style={{ background: '#e5e7eb', color: '#1a1a2e' }}>
              Back to Agent
            </button>
          </div>
        </form>
      )}

      {/* ─── JSON-LD Tab ─────────────────────────────────────────────── */}
      {activeTab === 'jsonld' && (
        <section data-component="graph-section">
          <h2>JSON-LD Metadata Document</h2>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>
            Generated from on-chain resolver data. This document can be pinned to IPFS and
            its hash stored on-chain. It is the SHACL-validatable semantic representation
            of this agent&apos;s identity.
          </p>

          {jsonLd ? (
            <>
              <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
                <dl>
                  <dt>@id</dt><dd style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>did:ethr:{chainId}:{agentAddress}</dd>
                  <dt>@type</dt><dd>{(jsonLd['@type'] as string) ?? 'unknown'}</dd>
                  <dt>Properties</dt><dd>{Object.keys(jsonLd).filter(k => !k.startsWith('@')).length} fields</dd>
                </dl>
              </div>

              <pre style={{
                background: '#f8f9fa', border: '1px solid #f0f1f3', borderRadius: 8,
                padding: '1rem', fontSize: '0.75rem', overflow: 'auto', maxHeight: 500,
                color: '#6b7280', lineHeight: 1.6,
              }}>
                {JSON.stringify(jsonLd, null, 2)}
              </pre>
            </>
          ) : (
            <p data-component="text-muted">Save metadata first, then preview the JSON-LD document.</p>
          )}
        </section>
      )}

      {/* ─── SHACL Validation Tab ────────────────────────────────────── */}
      {activeTab === 'shacl' && (
        <section data-component="graph-section">
          <h2>SHACL Shape Validation</h2>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '1rem' }}>
            Validates agent metadata against SHACL shapes defined in <code>ontology/shapes.ttl</code>.
            Each agent type has specific requirements.
          </p>

          <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
            <h3>Active Shape: {agentType === 'ai' ? 'atl:AIAgentShape' : agentType === 'org' ? 'atl:OrganizationAgentShape' : 'atl:PersonAgentShape'}</h3>
            <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
              {agentType === 'ai' && 'AI agents must declare: agent class, at least one capability, at least one trust model'}
              {agentType === 'org' && 'Organizations must provide: a description'}
              {agentType === 'person' && 'Person agents must have: at least one controller (EOA wallet)'}
            </p>
          </div>

          {shaclIssues.length === 0 ? (
            <div style={{ padding: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, textAlign: 'center' }}>
              <p style={{ color: '#22c55e', fontSize: '1rem', fontWeight: 600 }}>All SHACL constraints satisfied</p>
              <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>This agent&apos;s metadata conforms to the {agentType === 'ai' ? 'AIAgent' : agentType === 'org' ? 'OrganizationAgent' : 'PersonAgent'} shape</p>
            </div>
          ) : (
            <table data-component="graph-table">
              <thead>
                <tr><th>Severity</th><th>Property</th><th>Message</th></tr>
              </thead>
              <tbody>
                {shaclIssues.map((issue, i) => (
                  <tr key={i}>
                    <td>
                      <span data-component="role-badge" data-status={issue.severity === 'error' ? 'revoked' : 'proposed'}>
                        {issue.severity}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{issue.field}</td>
                    <td style={{ fontSize: '0.8rem', color: '#6b7280' }}>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
            <h3>Shape Requirements</h3>
            <table data-component="graph-table">
              <thead><tr><th>Property</th><th>Required</th><th>Constraint</th></tr></thead>
              <tbody>
                <tr><td>atl:displayName</td><td>All</td><td>1..1, string, max 100 chars</td></tr>
                <tr><td>atl:accountAddress</td><td>All</td><td>1..1, 0x-prefixed hex</td></tr>
                <tr><td>atl:isActive</td><td>All</td><td>1..1, boolean</td></tr>
                <tr><td>atl:agentType</td><td>All</td><td>1..1, in (PersonAgent, OrganizationAgent, AIAgent)</td></tr>
                <tr><td>atl:description</td><td>Org</td><td>1..1 for organizations, max 500 chars</td></tr>
                <tr><td>atl:hasController</td><td>Person</td><td>1..n for person agents</td></tr>
                <tr><td>atl:aiAgentClass</td><td>AI</td><td>1..1, in (Discovery, Validator, Executor, Assistant, Oracle)</td></tr>
                <tr><td>atl:supportedTrustModel</td><td>AI</td><td>1..n for AI agents</td></tr>
                <tr><td>atl:hasCapability</td><td>AI</td><td>1..n for AI agents</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
