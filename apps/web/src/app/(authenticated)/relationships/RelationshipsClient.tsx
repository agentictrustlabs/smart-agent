'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { assertRelationship } from '@/lib/actions/assert-relationship.action'

const ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'operator', label: 'Operator' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'board-member', label: 'Board Member' },
  { value: 'ceo', label: 'CEO' },
  { value: 'executive', label: 'Executive' },
  { value: 'treasurer', label: 'Treasurer' },
  { value: 'authorized-signer', label: 'Authorized Signer' },
  { value: 'validator', label: 'Validator' },
  { value: 'insurer', label: 'Insurer' },
  { value: 'staker', label: 'Staker' },
  { value: 'strategic-partner', label: 'Strategic Partner' },
  { value: 'service-provider', label: 'Service Provider' },
  { value: 'delegated-operator', label: 'Delegated Operator' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'operated-agent', label: 'Operated Agent' },
  { value: 'administers', label: 'Administers' },
  { value: 'activity-validator', label: 'Activity Validator' },
]

interface Agent {
  address: string
  name: string
  did: string
  type: string
}

interface RelationshipsClientProps {
  myAgents: Agent[]
  allAgents: Agent[]
}

export function RelationshipsClient({ myAgents, allAgents }: RelationshipsClientProps) {
  const router = useRouter()
  const [fromAgent, setFromAgent] = useState(myAgents[0]?.address ?? '')
  const [toAgent, setToAgent] = useState('')
  const [selectedRole, setSelectedRole] = useState('member')
  const [showAllTargets, setShowAllTargets] = useState(false)
  const [asserting, setAsserting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Target list: default to my agents, toggle to all
  const targetAgents = showAllTargets ? allAgents : myAgents
  // Filter out the "from" agent from target list
  const availableTargets = targetAgents.filter((a) => a.address.toLowerCase() !== fromAgent.toLowerCase())

  // Auto-select first target if current selection is not in the list
  const currentTarget = availableTargets.find((a) => a.address === toAgent)
  if (!currentTarget && availableTargets.length > 0 && toAgent !== availableTargets[0].address) {
    // Can't call setState during render, so we'll handle it in the select
  }

  const effectiveToAgent = currentTarget ? toAgent : availableTargets[0]?.address ?? ''

  const fromInfo = myAgents.find((a) => a.address === fromAgent)
  const toInfo = availableTargets.find((a) => a.address === effectiveToAgent)

  async function handleAssert(e: React.FormEvent) {
    e.preventDefault()
    if (!fromAgent || !effectiveToAgent) return

    setAsserting(true)
    setError('')
    setSuccess('')

    const result = await assertRelationship({
      personAgentAddress: fromAgent,
      orgAgentAddress: effectiveToAgent,
      role: selectedRole,
    })

    setAsserting(false)

    if (result.success) {
      const status = result.autoConfirmed ? 'Created and auto-confirmed (you own both agents)' : 'Created as PROPOSED — awaiting counterparty confirmation'
      setSuccess(`${fromInfo?.name} → ${toInfo?.name} [${selectedRole}]\n${status}`)
      router.refresh()
    } else {
      setError(result.error ?? 'Failed to create relationship')
    }
  }

  return (
    <section data-component="assert-section">
      <h2>Create Relationship</h2>
      <p data-component="assert-description">
        Create an on-chain relationship edge between two agents.
        Select one of your agents as the source, and any agent as the target.
      </p>

      <form onSubmit={handleAssert} data-component="assert-form">
        <div data-component="assert-visual">
          {/* FROM — always my agents */}
          <div data-component="assert-agent" data-type="subject">
            <span data-component="assert-label">From (My Agent)</span>
            <select
              value={fromAgent}
              onChange={(e) => setFromAgent(e.target.value)}
              data-component="org-select"
            >
              {myAgents.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
            {fromInfo && <code data-component="did">{fromInfo.did}</code>}
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

          {/* TO — my agents or all agents */}
          <div data-component="assert-agent" data-type="object">
            <div data-component="target-header">
              <span data-component="assert-label">To (Target Agent)</span>
              <button
                type="button"
                onClick={() => setShowAllTargets(!showAllTargets)}
                data-component="filter-btn"
                data-active={showAllTargets ? 'true' : 'false'}
              >
                {showAllTargets ? `All (${allAgents.length})` : `My Agents (${myAgents.length})`}
              </button>
            </div>
            <select
              value={effectiveToAgent}
              onChange={(e) => setToAgent(e.target.value)}
              data-component="org-select"
            >
              {availableTargets.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
            {toInfo && <code data-component="did">{toInfo.did}</code>}
          </div>
        </div>

        {error && <p role="alert" data-component="error-message">{error}</p>}
        {success && <p data-component="success-message">{success}</p>}

        <button type="submit" disabled={asserting || !effectiveToAgent}>
          {asserting ? 'Creating relationship (3 txns)...' : 'Create Relationship'}
        </button>
      </form>
    </section>
  )
}
