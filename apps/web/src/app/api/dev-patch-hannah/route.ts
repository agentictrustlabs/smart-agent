import { NextResponse } from 'next/server'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  getPublicClient, getWalletClient,
  createRelationship, confirmRelationship,
} from '@/lib/contracts'
import {
  agentAccountResolverAbi, ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  HAS_MEMBER, ORGANIZATION_MEMBERSHIP, ROLE_MEMBER, NAMESPACE_CONTAINS,
} from '@smart-agent/sdk'
import { keccak256, toBytes, getAddress } from 'viem'

/**
 * Dev-only one-shot: patch Hannah's on-chain registration after she was
 * added to DEMO_USER_META mid-session. Idempotent — re-running is safe.
 *
 * Adds:
 *   • setStringProperty primaryName + nameLabel on Hannah's person agent
 *   • HAS_MEMBER edge: Catalyst Hub → Hannah
 *   • ORGANIZATION_MEMBERSHIP edge: Hannah → Berthoud Circle
 *   • NAMESPACE_CONTAINS edge: Berthoud Circle → Hannah
 */
async function safeEdge(
  subject: `0x${string}`, object: `0x${string}`,
  relType: `0x${string}`, roles: `0x${string}`[], metadataURI = '',
): Promise<{ edgeId: `0x${string}` } | { skipped: string }> {
  try {
    const edgeId = await createRelationship({ subject, object, roles, relationshipType: relType, metadataURI })
    try { await confirmRelationship(edgeId) } catch { /* already confirmed */ }
    return { edgeId }
  } catch (e) {
    return { skipped: (e as Error).message }
  }
}

export async function POST() {
  try {
    const personAgent = await getPersonAgentForUser('cat-user-013') as `0x${string}` | null
    if (!personAgent) return NextResponse.json({ error: 'cat-user-013 not provisioned' }, { status: 400 })

    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!resolverAddr) return NextResponse.json({ error: 'AGENT_ACCOUNT_RESOLVER_ADDRESS unset' }, { status: 500 })

    const wc = getWalletClient()
    const pc = getPublicClient()

    // Resolve hub + Berthoud addresses by primaryName lookup.
    const findByName = async (name: string): Promise<`0x${string}` | null> => {
      const count = await pc.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount',
      }) as bigint
      for (let i = 0n; i < count; i++) {
        const a = await pc.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [i],
        }) as `0x${string}`
        const pn = await pc.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty',
          args: [getAddress(a), ATL_PRIMARY_NAME as `0x${string}`],
        }) as string
        if (pn === name) return a
      }
      return null
    }

    const catalystHub = await findByName('catalyst.agent')
    const berthoud = await findByName('berthoud.catalyst.agent')
    if (!catalystHub) return NextResponse.json({ error: 'catalyst.agent hub not found on-chain' }, { status: 400 })
    if (!berthoud) return NextResponse.json({ error: 'berthoud.catalyst.agent not found on-chain' }, { status: 400 })

    // 1. Set primaryName + label on Hannah's person agent (idempotent — overwrite).
    try {
      await wc.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'setStringProperty',
        args: [personAgent, ATL_PRIMARY_NAME as `0x${string}`, 'hannah.berthoud.catalyst.agent'],
      })
      await wc.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'setStringProperty',
        args: [personAgent, ATL_NAME_LABEL as `0x${string}`, 'hannah'],
      })
    } catch (e) {
      console.warn('[patch-hannah] setStringProperty', (e as Error).message)
    }

    // 2. Edges.
    const e1 = await safeEdge(catalystHub, personAgent, HAS_MEMBER as `0x${string}`, [keccak256(toBytes('member'))])
    const e2 = await safeEdge(personAgent, berthoud, ORGANIZATION_MEMBERSHIP as `0x${string}`, [ROLE_MEMBER as `0x${string}`])
    const e3 = await safeEdge(berthoud, personAgent, NAMESPACE_CONTAINS as `0x${string}`, [keccak256(toBytes('contains'))], JSON.stringify({ label: 'hannah' }))

    return NextResponse.json({
      ok: true,
      hannah: personAgent,
      catalystHub,
      berthoud,
      edges: { hasMember: e1, orgMembership: e2, namespaceContains: e3 },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
