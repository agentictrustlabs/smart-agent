import { NextResponse } from 'next/server'
import { resolveAgentName, reverseResolveAddress } from '@/lib/actions/explorer.action'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getPublicClient } from '@/lib/contracts'
import { agentAccountResolverAbi, ATL_PRIMARY_NAME } from '@smart-agent/sdk'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [] })

  const results: Array<{ name: string; address: string }> = []

  // 1. Try as .agent name (forward resolution)
  if (q.includes('.')) {
    const name = q.endsWith('.agent') ? q : q + '.agent'
    const resolved = await resolveAgentName(name)
    if (resolved) {
      const meta = await getAgentMetadata(resolved.address)
      results.push({ name: meta.primaryName || name, address: resolved.address })
    }
  }

  // 2. Try as address (reverse resolution)
  if (q.startsWith('0x') && q.length >= 10) {
    const name = await reverseResolveAddress(q)
    if (name) {
      results.push({ name, address: q })
    } else {
      // Show even without name
      try {
        const meta = await getAgentMetadata(q)
        results.push({ name: meta.primaryName || meta.displayName, address: q })
      } catch { /* not found */ }
    }
  }

  // 3. Fuzzy search — look through all registered agents for matching names
  if (results.length === 0 && !q.startsWith('0x')) {
    try {
      const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
      if (resolverAddr) {
        const client = getPublicClient()
        const count = Number(await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount' }) as bigint)
        const qLower = q.toLowerCase()

        for (let i = 0; i < Math.min(count, 100); i++) {
          const addr = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [BigInt(i)] }) as `0x${string}`
          const meta = await getAgentMetadata(addr)
          if (meta.displayName.toLowerCase().includes(qLower) || meta.primaryName.toLowerCase().includes(qLower) || meta.nameLabel.toLowerCase().includes(qLower)) {
            results.push({ name: meta.primaryName || meta.displayName, address: addr })
            if (results.length >= 10) break
          }
        }
      }
    } catch { /* search failed */ }
  }

  return NextResponse.json({ results })
}
