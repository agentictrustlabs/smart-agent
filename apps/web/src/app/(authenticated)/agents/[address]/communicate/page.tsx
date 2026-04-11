import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { CommunicateClient } from './CommunicateClient'
import { AgentSubNav } from '@/components/nav/AgentSubNav'

export default async function CommunicatePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const meta = await getAgentMetadata(address)

  return (
    <div data-page="communicate">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>Communicate with {meta.displayName}</h1>
          <Link href={`/agents/${address}`} data-component="section-action">Back to Agent</Link>
        </div>
        <p>Send tasks to this agent via A2A (Agent-to-Agent) protocol and view responses in real time.</p>
      </div>

      <AgentSubNav address={address} />

      {!meta.a2aEndpoint && !meta.mcpServer ? (
        <div data-component="empty-state">
          <p>This agent has no A2A endpoint or MCP server configured.</p>
          <Link href={`/agents/${address}/metadata`}>Configure endpoints in Metadata</Link>
        </div>
      ) : (
        <CommunicateClient
          agentName={meta.displayName}
          a2aEndpoint={meta.a2aEndpoint}
          mcpServer={meta.mcpServer}
        />
      )}
    </div>
  )
}
