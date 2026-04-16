import { getAgentMetadata } from '@/lib/agent-metadata'

/**
 * Server component that displays an agent's .agent name (if available)
 * as a monospace badge below the display name.
 */
export async function AgentNameBadge({ address }: { address: string }) {
  const meta = await getAgentMetadata(address)
  if (!meta.primaryName) return null

  return (
    <span style={{
      fontFamily: 'monospace',
      fontSize: '0.7rem',
      color: '#8b5e3c',
      background: 'rgba(139,94,60,0.08)',
      padding: '0.1rem 0.4rem',
      borderRadius: 6,
      border: '1px solid rgba(139,94,60,0.15)',
    }}>
      {meta.primaryName}
    </span>
  )
}
