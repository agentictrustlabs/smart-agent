'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OrgTemplate } from '@/lib/org-templates'
import {
  getDeploySteps,
  runDeployStep,
  type DeployStepId,
} from '@/lib/actions/deploy-from-template.action'

type Step = 'template' | 'configure' | 'deploying' | 'complete'

interface DeployedAgent { name: string; address: string; type: string }

interface ProgressStep {
  id: DeployStepId
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  error?: string
}

export function SetupWizardClient({ templates }: { templates: OrgTemplate[] }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('template')
  const [selectedTemplate, setSelectedTemplate] = useState<OrgTemplate | null>(null)
  const [orgName, setOrgName] = useState('')
  const [orgDescription, setOrgDescription] = useState('')
  const [minOwners, setMinOwners] = useState(1)
  const [quorum, setQuorum] = useState(1)
  const [error, setError] = useState('')
  const [orgAddress, setOrgAddress] = useState('')
  const [deployedAgents, setDeployedAgents] = useState<DeployedAgent[]>([])
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])

  function selectTemplate(t: OrgTemplate) {
    setSelectedTemplate(t)
    setMinOwners(t.defaultMinOwners)
    setQuorum(t.defaultQuorum)
    setStep('configure')
  }

  const updateStepStatus = useCallback(
    (id: DeployStepId, status: ProgressStep['status'], err?: string) => {
      setProgressSteps(prev =>
        prev.map(s => (s.id === id ? { ...s, status, error: err } : s)),
      )
    },
    [],
  )

  async function handleDeploy() {
    if (!selectedTemplate || !orgName.trim()) return
    setError('')
    setStep('deploying')

    // Build the step list for the progress bar
    const steps = await getDeploySteps(selectedTemplate)
    setProgressSteps(steps.map(s => ({ ...s, status: 'pending' as const })))

    const input = {
      template: selectedTemplate,
      orgName: orgName.trim(),
      orgDescription: orgDescription.trim(),
      minOwners,
      quorum,
    }

    // Accumulated context passed between steps
    const ctx: { orgAddress?: string; personAgentAddress?: string } = {}
    const agents: DeployedAgent[] = []

    for (const s of steps) {
      updateStepStatus(s.id, 'running')

      const result = await runDeployStep(s.id, input, ctx)

      if (!result.success) {
        updateStepStatus(s.id, 'failed', result.error)
        setError(result.error ?? 'Deployment failed')
        // Don't abort — mark remaining as pending and go to configure
        setStep('configure')
        return
      }

      // Accumulate context from step results
      if (result.data?.orgAddress) ctx.orgAddress = result.data.orgAddress
      if (result.data?.personAgentAddress) ctx.personAgentAddress = result.data.personAgentAddress
      if (result.data?.agentAddress && result.data?.agentName) {
        agents.push({
          name: result.data.agentName,
          address: result.data.agentAddress,
          type: result.data.agentType ?? 'custom',
        })
      }

      updateStepStatus(s.id, 'done')
    }

    setOrgAddress(ctx.orgAddress ?? '')
    setDeployedAgents(agents)
    setStep('complete')
  }

  // ─── Step 1: Template Selection ────────────────────────────────────
  if (step === 'template') {
    return (
      <div>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>New Organization</h1>
        <p style={{ color: '#616161', marginBottom: '2rem' }}>
          Select the structure that best fits your organization. Each option comes with pre-configured roles, governance, and AI assistants.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {templates.map((t) => (
            <button key={t.id} onClick={() => selectTemplate(t)}
              style={{
                background: '#ffffff', border: `2px solid ${t.color}33`, borderRadius: 12,
                padding: '1.5rem', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.borderColor = t.color }}
              onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${t.color}33` }}
            >
              <h3 style={{ color: t.color, marginBottom: '0.5rem' }}>{t.name}</h3>
              <p style={{ color: '#1a1a2e', fontSize: '0.9rem', marginBottom: '0.75rem' }}>{t.description}</p>
              <p style={{ color: '#616161', fontSize: '0.8rem', lineHeight: 1.5 }}>{t.details}</p>

              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>
                  {t.defaultMinOwners} min owners
                </span>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>
                  {t.roles.length} roles
                </span>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>
                  {t.aiAgents.length} AI agent{t.aiAgents.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#666' }}>Roles: </span>
                {t.roles.map(r => <span key={r.roleKey} data-component="role-badge" style={{ fontSize: '0.6rem', marginRight: 2 }}>{r.label}</span>)}
              </div>

              <div style={{ marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#666' }}>Agents: </span>
                {t.aiAgents.map(a => <span key={a.name} data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem', marginRight: 2 }}>{a.name}</span>)}
              </div>
            </button>
          ))}
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: '#e0e0e0', color: '#1a1a2e' }}>
            Skip — go to dashboard
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 2: Configure ─────────────────────────────────────────────
  if (step === 'configure' && selectedTemplate) {
    return (
      <div>
        <button onClick={() => setStep('template')} style={{ background: 'transparent', color: '#616161', padding: 0, marginBottom: '1rem', fontSize: '0.85rem' }}>
          ← Back to templates
        </button>

        <h1 style={{ fontSize: '1.8rem', marginBottom: '0.25rem' }}>
          <span style={{ color: selectedTemplate.color }}>{selectedTemplate.name}</span>
        </h1>
        <p style={{ color: '#616161', marginBottom: '1.5rem' }}>{selectedTemplate.description}</p>

        <form onSubmit={(e) => { e.preventDefault(); handleDeploy() }} data-component="deploy-form">
          <div data-component="form-field">
            <label htmlFor="orgName">Organization Name *</label>
            <input id="orgName" value={orgName} onChange={e => setOrgName(e.target.value)} required
              placeholder={`e.g., ${selectedTemplate.name === 'Service Business' ? 'Acme Services' : selectedTemplate.name === 'Investment Club' ? 'Alpha Capital' : 'My Organization'}`} />
          </div>

          <div data-component="form-field">
            <label htmlFor="orgDesc">Description</label>
            <textarea id="orgDesc" value={orgDescription} onChange={e => setOrgDescription(e.target.value)} rows={2}
              placeholder="What does this organization do?" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div data-component="form-field">
              <label htmlFor="minOwners">Minimum Owners</label>
              <input id="minOwners" type="number" min={1} max={10} value={minOwners}
                onChange={e => setMinOwners(Number(e.target.value))} />
              <p style={{ fontSize: '0.7rem', color: '#666' }}>Required signers before org is fully active</p>
            </div>
            <div data-component="form-field">
              <label htmlFor="quorum">Approval Quorum</label>
              <input id="quorum" type="number" min={1} max={minOwners} value={quorum}
                onChange={e => setQuorum(Number(e.target.value))} />
              <p style={{ fontSize: '0.7rem', color: '#666' }}>Approvals needed per proposal</p>
            </div>
          </div>

          {/* What will be deployed */}
          <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
            <h3>This will deploy:</h3>
            <dl>
              <dt>Organization</dt>
              <dd>Smart account with {quorum}-of-{minOwners} approval governance</dd>
              {selectedTemplate.aiAgents.filter(a => a.autoDeploy).map(a => (
                <span key={a.name}>
                  <dt>{a.name}</dt>
                  <dd>{a.description}</dd>
                </span>
              ))}
              <dt>Relationships</dt>
              <dd>{selectedTemplate.aiAgents.filter(a => a.autoDeploy).length} org-control edges auto-created</dd>
              <dt>Metadata</dt>
              <dd>All agents registered in on-chain resolver</dd>
            </dl>
          </div>

          {/* Roles preview */}
          <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
            <h3>Available Roles</h3>
            <table data-component="graph-table">
              <thead><tr><th>Role</th><th>Description</th><th>Limit</th></tr></thead>
              <tbody>
                {selectedTemplate.roles.map(r => (
                  <tr key={r.roleKey}>
                    <td><span data-component="role-badge">{r.label}</span></td>
                    <td style={{ fontSize: '0.8rem', color: '#616161' }}>{r.description}</td>
                    <td style={{ fontSize: '0.8rem' }}>{r.maxCount === Infinity ? 'Unlimited' : `Max ${r.maxCount}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p role="alert" data-component="error-message">{error}</p>}

          <button type="submit" disabled={!orgName.trim()}>
            Create Organization
          </button>
        </form>
      </div>
    )
  }

  // ─── Step 3: Deploying (with progress bar) ─────────────────────────
  if (step === 'deploying') {
    const doneCount = progressSteps.filter(s => s.status === 'done').length
    const totalCount = progressSteps.length
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

    return (
      <div style={{ padding: '2rem 0' }}>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', textAlign: 'center' }}>
          Setting Up Your Organization
        </h1>
        <p style={{ color: '#616161', marginBottom: '1.5rem', textAlign: 'center' }}>
          Deploying smart accounts, configuring governance, and launching AI assistants on-chain.
        </p>

        {/* Progress bar */}
        <div style={{
          background: '#e0e0e0',
          borderRadius: 8,
          height: 8,
          marginBottom: '1.5rem',
          overflow: 'hidden',
        }}>
          <div style={{
            background: '#1565c0',
            height: '100%',
            borderRadius: 8,
            width: `${pct}%`,
            transition: 'width 0.4s ease',
          }} />
        </div>

        <p style={{
          textAlign: 'center',
          fontSize: '0.82rem',
          color: '#616161',
          marginBottom: '1.5rem',
        }}>
          {doneCount} of {totalCount} steps complete ({pct}%)
        </p>

        {/* Step list */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e0e0e0',
          borderRadius: 12,
          padding: '1rem',
        }}>
          {progressSteps.map((s) => (
            <div key={s.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 0',
              borderBottom: '1px solid #f5f5f5',
            }}>
              {/* Status indicator */}
              <span style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                flexShrink: 0,
                ...(s.status === 'done'
                  ? { background: '#e8f5e9', color: '#2e7d32' }
                  : s.status === 'running'
                    ? { background: '#e3f2fd', color: '#1565c0', animation: 'pulse 1.5s infinite' }
                    : s.status === 'failed'
                      ? { background: '#ffebee', color: '#c62828' }
                      : { background: '#f5f5f5', color: '#bdbdbd' }),
              }}>
                {s.status === 'done' && '\u2713'}
                {s.status === 'running' && '\u25CF'}
                {s.status === 'failed' && '\u2717'}
                {s.status === 'pending' && '\u25CB'}
              </span>

              {/* Label */}
              <span style={{
                fontSize: '0.85rem',
                fontWeight: s.status === 'running' ? 600 : 400,
                color: s.status === 'pending' ? '#9e9e9e'
                  : s.status === 'failed' ? '#c62828'
                    : '#333',
              }}>
                {s.label}
              </span>

              {/* Error detail */}
              {s.error && (
                <span style={{ fontSize: '0.75rem', color: '#c62828', marginLeft: 'auto' }}>
                  {s.error}
                </span>
              )}
            </div>
          ))}
        </div>

        <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
      </div>
    )
  }

  // ─── Step 4: Complete ──────────────────────────────────────────────
  if (step === 'complete') {
    return (
      <div>
        <h1 style={{ fontSize: '1.8rem', color: '#10b981', marginBottom: '0.5rem' }}>Organization Ready</h1>
        <p style={{ color: '#616161', marginBottom: '1.5rem' }}>
          Your organization, roles, and AI assistants are set up and ready to use.
        </p>

        <div data-component="protocol-info">
          <h3>{orgName}</h3>
          <dl>
            <dt>Organization</dt>
            <dd data-component="address">{orgAddress}</dd>
            <dt>Template</dt>
            <dd>{selectedTemplate?.name}</dd>
            <dt>Governance</dt>
            <dd>{quorum}-of-{minOwners} approval required</dd>
          </dl>
        </div>

        {deployedAgents.length > 0 && (
          <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
            <h3>Deployed AI Agents</h3>
            {deployedAgents.map(a => (
              <dl key={a.address}>
                <dt>{a.name} <span data-component="role-badge">{a.type}</span></dt>
                <dd data-component="address">{a.address}</dd>
              </dl>
            ))}
          </div>
        )}

        {/* Invite links for roles */}
        {selectedTemplate && selectedTemplate.roles.filter(r => r.generateInvite).length > 0 && (
          <div data-component="protocol-info" style={{ marginTop: '1rem' }}>
            <h3>Invite Team Members</h3>
            <p style={{ fontSize: '0.8rem', color: '#616161', marginBottom: '0.75rem' }}>
              Share invite links with your team. Each role can be assigned during onboarding.
            </p>
            {selectedTemplate.roles.filter(r => r.generateInvite).map(r => (
              <div key={r.roleKey} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span data-component="role-badge">{r.label}</span>
                <span style={{ fontSize: '0.8rem', color: '#616161' }}>{r.description}</span>
              </div>
            ))}
            <p style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.5rem' }}>
              Generate invite codes from the Team page after setup.
            </p>
          </div>
        )}

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => router.push('/dashboard')}>Go to Home</button>
          <button onClick={() => router.push('/team')} style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Invite People</button>
          <button onClick={() => router.push('/agents')} style={{ background: '#e0e0e0', color: '#1a1a2e' }}>View Agents</button>
        </div>
      </div>
    )
  }

  return null
}
