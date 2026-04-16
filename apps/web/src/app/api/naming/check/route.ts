import { NextResponse } from 'next/server'
import { getPublicClient } from '@/lib/contracts'
import { agentNameRegistryAbi, namehash } from '@smart-agent/sdk'

/**
 * GET /api/naming/check?name=wellington.catalyst.agent
 * Check if a .agent name is already registered.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 })

  const registryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  if (!registryAddr) return NextResponse.json({ exists: false })

  try {
    const node = namehash(name)
    const client = getPublicClient()
    const exists = await client.readContract({
      address: registryAddr,
      abi: agentNameRegistryAbi,
      functionName: 'recordExists',
      args: [node],
    }) as boolean

    return NextResponse.json({ exists, node, name })
  } catch {
    return NextResponse.json({ exists: false })
  }
}
