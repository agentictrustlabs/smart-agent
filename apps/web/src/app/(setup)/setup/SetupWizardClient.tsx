'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OrgTemplate } from '@/lib/org-templates'
import { deployFromTemplate } from '@/lib/actions/deploy-from-template.action'

type Step = 'template' | 'configure' | 'deploying' | 'complete'

interface DeployedAgent { name: string; address: string; type: string }

export function SetupWizardClient({ templates }: { templates: OrgTemplate[] }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('template')
  const [selectedTemplate, setSelectedTemplate] = useState<OrgTemplate | null>(null)
  const [orgName, setOrgName] = useState('')
  const [orgDescription, setOrgDescription] = useState('')
  const [minOwners, setMinOwners] = useState(1)
  const [quorum, setQuorum] = useState(1)
  const [error, setError] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [orgAddress, setOrgAddress] = useState('')
  const [deployedAgents, setDeployedAgents] = useState<DeployedAgent[]>([])

  function selectTemplate(t: OrgTemplate) {
    setSelectedTemplate(t)
    setMinOwners(t.defaultMinOwners)
    setQuorum(t.defaultQuorum)
    setStep('configure')
  }

  async function handleDeploy() {
    if (!selectedTemplate || !orgName.trim()) return
    setDeploying(true)
    setError('')
    setStep('deploying')

    const result = await deployFromTemplate({
      template: selectedTemplate,
      orgName: orgName.trim(),
      orgDescription: orgDescription.trim(),
      minOwners,
      quorum,
    })

    setDeploying(false)

    if (result.success) {
      setOrgAddress(result.orgAddress ?? '')
      setDeployedAgents(result.deployedAgents ?? [])
      setStep('complete')
    } else {
      setError(result.error ?? 'Deployment failed')
      setStep('configure')
    }
  }

  // ─── Step 1: Template Selection ────────────────────────────────────
  if (step === 'template') {
    return (
      <div>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>New Organization</h1>
        <p style={{ color: '#6b7280', marginBottom: '2rem' }}>
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
              <p style={{ color: '#6b7280', fontSize: '0.8rem', lineHeight: 1.5 }}>{t.details}</p>

              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: '#f0f1f3', borderRadius: 4, color: '#6b7280' }}>
                  {t.defaultMinOwners} min owners
                </span>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: '#f0f1f3', borderRadius: 4, color: '#6b7280' }}>
                  {t.roles.length} roles
                </span>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: '#f0f1f3', borderRadius: 4, color: '#6b7280' }}>
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
          <button onClick={() => router.push('/dashboard')} style={{ background: '#e5e7eb', color: '#1a1a2e' }}>
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
        <button onClick={() => setStep('template')} style={{ background: 'transparent', color: '#6b7280', padding: 0, marginBottom: '1rem', fontSize: '0.85rem' }}>
          ← Back to templates
        </button>

        <h1 style={{ fontSize: '1.8rem', marginBottom: '0.25rem' }}>
          <span style={{ color: selectedTemplate.color }}>{selectedTemplate.name}</span>
        </h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>{selectedTemplate.description}</p>

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
                    <td style={{ fontSize: '0.8rem', color: '#6b7280' }}>{r.description}</td>
                    <td style={{ fontSize: '0.8rem' }}>{r.maxCount === Infinity ? 'Unlimited' : `Max ${r.maxCount}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p role="alert" data-component="error-message">{error}</p>}

          <button type="submit" disabled={deploying || !orgName.trim()}>
            Create Organization
          </button>
        </form>
      </div>
    )
  }

  // ─── Step 3: Deploying ─────────────────────────────────────────────
  if (step === 'deploying') {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 0' }}>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>Setting Up Your Organization</h1>
        <p style={{ color: '#6b7280', marginBottom: '2rem' }}>
          Creating accounts, configuring governance, launching AI assistants...
        </p>
        <div style={{ width: 40, height: 40, border: '3px solid #333', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // ─── Step 4: Complete ──────────────────────────────────────────────
  if (step === 'complete') {
    return (
      <div>
        <h1 style={{ fontSize: '1.8rem', color: '#10b981', marginBottom: '0.5rem' }}>Organization Ready</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
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
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.75rem' }}>
              Share invite links with your team. Each role can be assigned during onboarding.
            </p>
            {selectedTemplate.roles.filter(r => r.generateInvite).map(r => (
              <div key={r.roleKey} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span data-component="role-badge">{r.label}</span>
                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{r.description}</span>
              </div>
            ))}
            <p style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.5rem' }}>
              Generate invite codes from the Team page after setup.
            </p>
          </div>
        )}

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => router.push('/dashboard')}>Go to Home</button>
          <button onClick={() => router.push('/team')} style={{ background: '#e5e7eb', color: '#1a1a2e' }}>Invite People</button>
          <button onClick={() => router.push('/agents')} style={{ background: '#e5e7eb', color: '#1a1a2e' }}>View Agents</button>
        </div>
      </div>
    )
  }

  return null
}
