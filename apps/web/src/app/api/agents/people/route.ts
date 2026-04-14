import { NextResponse } from 'next/server'
import { toDidEthr } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { listRegisteredAgents } from '@/lib/agent-resolver'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export async function GET() {
  const users = await db.select().from(schema.users)
  const personAgents = (await listRegisteredAgents()).filter(agent => agent.kind === 'person')

  const people = personAgents.map((p) => {
    const user = users.find((u) =>
      p.controllers.some(controller => controller.toLowerCase() === u.walletAddress.toLowerCase())
    )
    return {
      userId: user?.id ?? '',
      name: p.name || user?.name || 'Person Agent',
      walletAddress: user?.walletAddress ?? '',
      smartAccountAddress: p.address,
      did: toDidEthr(CHAIN_ID, p.address as `0x${string}`),
    }
  })

  return NextResponse.json({ people })
}
