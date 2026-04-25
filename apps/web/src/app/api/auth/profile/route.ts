import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getPersonAgentForUser } from '@/lib/agent-registry'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Get user from DB
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.privyUserId, session.userId))
    .limit(1)

  const user = users[0]
  if (!user) {
    return NextResponse.json({
      name: null,
      walletAddress: session.walletAddress,
      smartAccountAddress: null,
    })
  }

  // Prefer the persisted addresses on the user row — they're written by the
  // signup/seed paths and don't require an on-chain scan. Fall back to the
  // (slow) on-chain iteration only when the DB doesn't have one yet, e.g. for
  // a partially-provisioned legacy row.
  const personAgentAddress =
    user.personAgentAddress ?? user.smartAccountAddress ?? (await getPersonAgentForUser(user.id))

  // Reverse-resolve the .agent primary name for the connected user's smart
  // account. The dropdown surface uses this whenever it's set so users see
  // "joe.catalyst.agent" instead of "Joe Smith" / 0xabcd…1234. We try the
  // on-chain resolver first, then fall back to the DB-mirrored value
  // (written by registerPersonalAgentName when the resolver write was
  // skipped on a legacy account).
  let primaryName: string | null = null
  try {
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (resolverAddr && (user.smartAccountAddress ?? personAgentAddress)) {
      const { getPublicClient } = await import('@/lib/contracts')
      const { agentAccountResolverAbi, ATL_PRIMARY_NAME } = await import('@smart-agent/sdk')
      const { getAddress } = await import('viem')
      const target = (user.smartAccountAddress ?? personAgentAddress) as `0x${string}`
      const v = await getPublicClient().readContract({
        address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty',
        args: [getAddress(target), ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
      primaryName = v || null
    }
  } catch { /* on-chain unavailable; non-fatal */ }
  if (!primaryName && user.agentName) primaryName = user.agentName

  return NextResponse.json({
    name: user.name,
    email: user.email,
    walletAddress: user.walletAddress,
    smartAccountAddress: personAgentAddress,
    primaryName,
  })
}

export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const { name, email } = body as { name?: string; email?: string }

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const updates: Record<string, string> = { name: name.trim() }
  if (email?.trim()) updates.email = email.trim()

  await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.privyUserId, session.userId))

  // Person-agent provisioning happens later — the setup wizard's `person-agent`
  // step (or any other deploy site that needs it) will create it on first use.
  // We do NOT fire-and-forget here: a detached promise outlives the route's
  // request scope, and Next.js's fetch wrapper leaves the in-flight viem
  // request in a state that hangs every subsequent deployer-signed write in
  // the same dev process.
  return NextResponse.json({ success: true, name: name.trim() })
}
