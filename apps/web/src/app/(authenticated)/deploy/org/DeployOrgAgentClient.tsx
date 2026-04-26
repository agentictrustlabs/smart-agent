'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deployOrgAgent } from '@/lib/actions/deploy-org-agent.action'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function DeployOrgAgentClient() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [minOwners, setMinOwners] = useState('1')
  const [quorum, setQuorum] = useState('1')
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    agentId: string
    smartAccountAddress: string
  } | null>(null)

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Organization name is required'); return }

    setDeploying(true)
    setError('')

    const res = await deployOrgAgent({
      name,
      description,
      minOwners: Number(minOwners),
      quorum: Number(quorum),
      coOwners: [],
    })

    setDeploying(false)

    if (res.success && res.agentId && res.smartAccountAddress) {
      setResult({ agentId: res.agentId, smartAccountAddress: res.smartAccountAddress })
    } else {
      setError(res.error ?? 'Deployment failed')
    }
  }

  if (result) {
    return (
      <Card className="animate-fade-in">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[#e8f5e9] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#2e7d32"/></svg>
            </div>
            <div>
              <h2 className="text-title-lg font-semibold text-on-surface">Organization Deployed</h2>
              <Badge variant="success">Active</Badge>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between items-center py-2 border-b border-outline-variant">
              <span className="text-label-md text-on-surface-variant">Organization</span>
              <span className="text-body-md font-semibold text-on-surface">{name}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-outline-variant">
              <span className="text-label-md text-on-surface-variant">Smart Account</span>
              <code className="text-body-sm font-mono text-primary">{result.smartAccountAddress.slice(0, 10)}...{result.smartAccountAddress.slice(-8)}</code>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-outline-variant">
              <span className="text-label-md text-on-surface-variant">Governance</span>
              <span className="text-body-md text-on-surface">Min owners: {minOwners}, Quorum: {quorum}</span>
            </div>
          </div>

          <p className="text-body-md text-on-surface-variant mb-6">
            {Number(minOwners) > 1
              ? `This agent is in bootstrap mode — invite ${Number(minOwners) - 1} more co-owner(s) to activate governance.`
              : 'Governance is active. You can invite co-owners from the agent settings page.'}
          </p>

          <div className="flex gap-3">
            <Button onClick={() => router.push(`/agents/${result.smartAccountAddress}`)}>
              Invite Co-Owners
            </Button>
            <Button variant="outlined" onClick={() => router.push('/dashboard')}>
              Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={handleDeploy} className="flex flex-col gap-5">
          <h3 className="text-title-md font-semibold text-on-surface">Organization Details</h3>

          <Input
            label="Organization Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Grace Community Church"
            required
            error={error && !name.trim() ? 'Organization name is required' : undefined}
          />

          <div className="flex flex-col gap-1">
            <label className="text-label-md text-on-surface-variant">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this organization do?"
              rows={3}
              className="w-full rounded-xs border border-outline-variant bg-transparent px-3 py-2 text-body-md text-on-surface placeholder:text-on-surface-variant/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-all duration-200"
            />
          </div>

          <div>
            <h3 className="text-title-md font-semibold text-on-surface mb-1">Multi-Sig Governance</h3>
            <p className="text-body-sm text-on-surface-variant mb-4">
              Configure ownership requirements. You are the first owner — invite co-owners after creation.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Minimum Owners"
                type="number"
                min={1}
                max={10}
                value={minOwners}
                onChange={(e) => setMinOwners(e.target.value)}
                helperText="Activates governance when met"
              />
              <Input
                label="Quorum"
                type="number"
                min={1}
                max={10}
                value={quorum}
                onChange={(e) => setQuorum(e.target.value)}
                helperText="Votes needed for proposals"
              />
            </div>
          </div>

          {error && error !== 'Organization name is required' && (
            <div className="rounded-sm bg-error-container p-3 text-body-md text-error" role="alert">
              {error}
            </div>
          )}

          <Button type="submit" disabled={deploying} size="lg" className="w-full">
            {deploying ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Deploying + Setting Up Governance...
              </span>
            ) : 'Deploy Organization Agent'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
