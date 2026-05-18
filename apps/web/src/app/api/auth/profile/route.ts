/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { validateRequest } from '@/lib/auth/validate-request'

// Profile edit body — keep narrow. Email is RFC-5321 bounded (320 chars);
// name is generous but capped.
const PutBodySchema = z.object({
  name: z.string().max(256).optional(),
  email: z.string().max(320).optional(),
})

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Stateless auth (passkey/SIWE) — no `local_user_accounts` row by design.
  // Profile lives in person-mcp (under the principal derived from the smart
  // account). Fetch via delegation and fall back to JWT-derived fields when
  // person-mcp is unreachable.
  const stateless = session.via === 'passkey' || session.via === 'siwe'
  if (stateless) {
    let primaryName: string | null = null
    try {
      const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
      if (resolverAddr && session.smartAccountAddress) {
        const { getPublicClient } = await import('@/lib/contracts')
        const { agentAccountResolverAbi, ATL_PRIMARY_NAME } = await import('@smart-agent/sdk')
        const { getAddress } = await import('viem')
        const v = await getPublicClient().readContract({
          address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty',
          args: [getAddress(session.smartAccountAddress as `0x${string}`), ATL_PRIMARY_NAME as `0x${string}`],
        }) as string
        primaryName = v || null
      }
    } catch { /* on-chain unavailable */ }

    // Pull the persisted profile from person-mcp. Best-effort — the user
    // may not have edited it yet (returns null profile in that case) or
    // person-mcp may be unreachable.
    let mcpProfile: { displayName?: string | null; email?: string | null } | null = null
    try {
      const { callMcp } = await import('@/lib/clients/mcp-client')
      const r = await callMcp<{ profile: { displayName?: string | null; email?: string | null } | null }>(
        'person', 'get_profile', {},
      )
      mcpProfile = r.profile ?? null
    } catch { /* person-mcp unreachable; fall through to JWT */ }

    return NextResponse.json({
      name: mcpProfile?.displayName ?? session.name ?? primaryName ?? null,
      email: mcpProfile?.email ?? session.email ?? null,
      walletAddress: session.walletAddress,
      smartAccountAddress: session.smartAccountAddress ?? null,
      primaryName,
    })
  }

  // Stateful (demo/google) — fall through to the users-row lookup.
  const users = await db
    .select()
    .from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.did, session.userId))
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

  const parsed = await validateRequest(request, { schema: PutBodySchema })
  if (!parsed.ok) return parsed.response
  const { name, email } = parsed.data

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Stateless auth (passkey/SIWE) — no local_user_accounts row. Profile
  // edits go to person-mcp's `update_profile` tool via the user's
  // A2A delegation. Person-mcp persists the row keyed on the principal
  // derived from the session smart account.
  const stateless = session.via === 'passkey' || session.via === 'siwe'
  if (stateless) {
    try {
      const { callMcp } = await import('@/lib/clients/mcp-client')
      const args: Record<string, string> = { displayName: name.trim() }
      if (email?.trim()) args.email = email.trim()
      await callMcp('person', 'update_profile', args)
      return NextResponse.json({ success: true, name: name.trim() })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return NextResponse.json(
        { error: `person-mcp update_profile failed: ${msg}` },
        { status: 502 },
      )
    }
  }

  const updates: Record<string, string> = { name: name.trim() }
  if (email?.trim()) updates.email = email.trim()

  await db
    .update(schema.localUserAccounts)
    .set(updates)
    .where(eq(schema.localUserAccounts.did, session.userId))

  // Person-agent provisioning happens later — the setup wizard's `person-agent`
  // step (or any other deploy site that needs it) will create it on first use.
  // We do NOT fire-and-forget here: a detached promise outlives the route's
  // request scope, and Next.js's fetch wrapper leaves the in-flight viem
  // request in a state that hangs every subsequent deployer-signed write in
  // the same dev process.
  return NextResponse.json({ success: true, name: name.trim() })
}
