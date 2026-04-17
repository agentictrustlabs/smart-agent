import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { DeployOrgAgentClient } from './DeployOrgAgentClient'

export default async function DeployOrgAgentPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  return (
    <div className="max-w-2xl mx-auto py-8 px-6">
      <div className="mb-6">
        <h1 className="text-headline-md font-bold text-on-surface mb-2">Deploy Organization Agent</h1>
        <p className="text-body-lg text-on-surface-variant leading-relaxed">
          Create an organization-level ERC-4337 smart account with multi-owner governance and delegated authority.
        </p>
      </div>

      <div className="bg-primary-container/50 rounded-md p-5 mb-6">
        <h2 className="text-title-sm font-semibold text-on-surface mb-3">What you get</h2>
        <ul className="space-y-2">
          {[
            'Organization ERC-4337 smart account (AgentAccount)',
            'Multi-owner support with quorum governance',
            'Delegation framework for scoped permissions',
            'Session keys for automated operations',
            'Deterministic CREATE2 deployment + .agent name',
          ].map(item => (
            <li key={item} className="flex items-start gap-2 text-body-md text-on-surface-variant">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-primary flex-shrink-0 mt-0.5"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/></svg>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <DeployOrgAgentClient />
    </div>
  )
}
