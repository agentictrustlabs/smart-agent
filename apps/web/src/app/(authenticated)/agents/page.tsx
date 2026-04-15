import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listAllAgents } from '@/lib/actions/list-all-agents.action'
import { AgentRegistryList } from '@/components/agent/AgentRegistryList'

export default async function AgentsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const agents = await listAllAgents()

  return (
    <div data-page="agents">
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Agent Registry</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
          All on-chain registered agents — people, organizations, AI agents, and hubs. Click an agent to view its trust profile.
        </p>
      </div>

      <AgentRegistryList agents={agents} />
    </div>
  )
}
