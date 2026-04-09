'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { assertRelationship } from '@/lib/actions/assert-relationship.action'

const ROLES = [
  { value: 'owner', label: 'Owner', desc: 'Full control over the organization agent' },
  { value: 'admin', label: 'Admin', desc: 'Can manage members and settings' },
  { value: 'member', label: 'Member', desc: 'Standard member access' },
  { value: 'operator', label: 'Operator', desc: 'Can execute operations' },
  { value: 'auditor', label: 'Auditor', desc: 'Read-only audit access' },
  { value: 'vendor', label: 'Vendor', desc: 'External service provider' },
]

interface Agent {
  address: string
  did: string
  label: string
}

interface RelationshipsClientProps {
  personAgent: Agent
  orgAgents: Agent[]
}

export function RelationshipsClient({ personAgent, orgAgents }: RelationshipsClientProps) {
  const router = useRouter()
  const [selectedOrg, setSelectedOrg] = useState(orgAgents[0]?.address ?? '')
  const [selectedRole, setSelectedRole] = useState('member')
  const [asserting, setAsserting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleAssert(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedOrg) return

    setAsserting(true)
    setError('')
    setSuccess('')

    const result = await assertRelationship({
      personAgentAddress: personAgent.address,
      orgAgentAddress: selectedOrg,
      role: selectedRole,
    })

    setAsserting(false)

    if (result.success) {
      const orgLabel = orgAgents.find((o) => o.address === selectedOrg)?.label ?? selectedOrg
      setSuccess(
        `On-chain: createEdge → setEdgeStatus(ACTIVE) → makeAssertion(OBJECT_ASSERTED)\n` +
        `${personAgent.label} is ${selectedRole} of ${orgLabel}\n` +
        `Edge ID: ${result.edgeId}`
      )
      router.refresh()
    } else {
      setError(result.error ?? 'Failed to create relationship')
    }
  }

  const selectedRoleInfo = ROLES.find((r) => r.value === selectedRole)
  const selectedOrgAgent = orgAgents.find((o) => o.address === selectedOrg)

  return (
    <section data-component="assert-section">
      <h2>Create Relationship</h2>
      <p data-component="assert-description">
        Creates an on-chain relationship edge between your Person Agent and an Org Agent.
        Three transactions: <strong>createEdge</strong> (AgentRelationship) →
        <strong> setEdgeStatus(ACTIVE)</strong> → <strong>makeAssertion(OBJECT_ASSERTED)</strong> (AgentAssertion)
      </p>

      <form onSubmit={handleAssert} data-component="assert-form">
        <div data-component="assert-visual">
          <div data-component="assert-agent" data-type="subject">
            <span data-component="assert-label">Subject</span>
            <span data-component="assert-name">{personAgent.label}</span>
            <code data-component="did">{personAgent.did}</code>
          </div>

          <div data-component="assert-arrow">
            <span>plays</span>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              data-component="role-select"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <span>in</span>
          </div>

          <div data-component="assert-agent" data-type="object">
            <span data-component="assert-label">Object (Authority)</span>
            <select
              value={selectedOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
              data-component="org-select"
            >
              {orgAgents.map((o) => (
                <option key={o.address} value={o.address}>{o.label}</option>
              ))}
            </select>
            <code data-component="did">{selectedOrgAgent?.did}</code>
          </div>
        </div>

        {selectedRoleInfo && (
          <p data-component="role-description">{selectedRoleInfo.desc}</p>
        )}

        {error && <p role="alert" data-component="error-message">{error}</p>}
        {success && <pre data-component="success-message">{success}</pre>}

        <button type="submit" disabled={asserting}>
          {asserting ? 'Creating edge + assertion (3 txns)...' : 'Create Relationship'}
        </button>
      </form>
    </section>
  )
}
