import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { toDidEthr } from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export async function GET() {
  const users = await db.select().from(schema.users)
  const personAgents = await db.select().from(schema.personAgents)

  const people = personAgents.map((p) => {
    const user = users.find((u) => u.id === p.userId)
    return {
      userId: p.userId,
      name: (p as Record<string, unknown>).name as string || user?.name || 'Person Agent',
      walletAddress: user?.walletAddress ?? '',
      smartAccountAddress: p.smartAccountAddress,
      did: toDidEthr(CHAIN_ID, p.smartAccountAddress as `0x${string}`),
    }
  })

  return NextResponse.json({ people })
}
