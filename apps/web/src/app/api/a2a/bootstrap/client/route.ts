import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  hashDelegation,
  encodeTimestampTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  encodeValueTerms,
  encodeMcpToolScopeTerms,
  buildCaveat,
  MCP_TOOL_SCOPE_ENFORCER,
  ROOT_AUTHORITY,
  TOOL_POLICIES,
} from '@smart-agent/sdk'
import {
  computeAllowedTargetAddresses,
  computeAllowedSelectors,
} from '@/lib/actions/a2a-session-caveats'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * POST /api/a2a/bootstrap/client
 *
 * Single-signature A2A bootstrap — no deployer key, no challenge.
 *
 *   1. Deploy smart account if needed
 *   2. Call A2A /session/init (unauthenticated — just generates keypair)
 *   3. Build delegation hash (delegator=user, delegate=session key)
 *   4. Return delegation hash for ONE MetaMask signature
 *
 * The delegation signature IS the authentication (verified via ERC-1271
 * in the A2A agent's /session/package endpoint).
 */
export async function POST() {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const walletAddress = session.walletAddress
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

  // Look up user
  const users = await db.select().from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.walletAddress, walletAddress))
    .limit(1)
  let user = users[0]

  // Deploy smart account if needed
  if (user && !user.smartAccountAddress) {
    try {
      const { deploySmartAccount } = await import('@/lib/contracts')
      const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
      const smartAcct = await deploySmartAccount(walletAddress as `0x${string}`, salt)
      await db.update(schema.localUserAccounts)
        .set({ smartAccountAddress: smartAcct })
        .where(eq(schema.localUserAccounts.id, user.id))
      user = { ...user, smartAccountAddress: smartAcct }
    } catch (err) {
      return NextResponse.json({ error: `Smart account deployment failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 })
    }
  }

  const accountAddress = (user?.smartAccountAddress ?? walletAddress) as `0x${string}`

  try {
    // ─── Step 1: Session init (unauthenticated — just generates keypair) ─
    const initRes = await fetch(`${A2A_AGENT_URL}/session/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountAddress, durationSeconds: 86400 }),
    })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}))
      return NextResponse.json({ error: `Session init: ${err.error ?? initRes.statusText}` }, { status: 502 })
    }
    const { sessionId, sessionKeyAddress } = await initRes.json()

    // ─── Step 2: Build delegation hash with FULL caveat set ─────────
    // Same caveats as the server-side bootstrap (a2a-session.action.ts):
    // Timestamp + AllowedTargets + AllowedMethods + Value + McpToolScope.
    // Without these, the resulting session can't call any write-capable
    // MCP tool (org-mcp rejects with "not permitted by delegation scope")
    // or redeem any contract write (DelegationManager rejects the call
    // through AllowedTargets/AllowedMethods caveats).
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 86400
    const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
    const allowedTargetsEnforcerAddr = process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as `0x${string}` | undefined
    const allowedMethodsEnforcerAddr = process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as `0x${string}` | undefined
    const valueEnforcerAddr = process.env.VALUE_ENFORCER_ADDRESS as `0x${string}` | undefined
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
    if (!allowedTargetsEnforcerAddr || !allowedMethodsEnforcerAddr || !valueEnforcerAddr) {
      return NextResponse.json({ error: 'enforcer addresses missing from env' }, { status: 500 })
    }

    const allowedTargets = computeAllowedTargetAddresses()
    const allowedSelectors = computeAllowedSelectors()
    const allowedToolNames = Object.keys(TOOL_POLICIES)
    const caveats = [
      buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt)),
      buildCaveat(allowedTargetsEnforcerAddr, encodeAllowedTargetsTerms(allowedTargets)),
      buildCaveat(allowedMethodsEnforcerAddr, encodeAllowedMethodsTerms(allowedSelectors)),
      buildCaveat(valueEnforcerAddr, encodeValueTerms(0n)),
      buildCaveat(
        (process.env.MCP_TOOL_SCOPE_ENFORCER_ADDRESS ?? MCP_TOOL_SCOPE_ENFORCER) as `0x${string}`,
        encodeMcpToolScopeTerms(allowedToolNames),
      ),
    ]
    const caveatsForHash = caveats.map((c) => ({
      enforcer: c.enforcer as `0x${string}`,
      terms: c.terms as `0x${string}`,
    }))
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))

    const delegation = {
      delegator: accountAddress,
      delegate: sessionKeyAddress as `0x${string}`,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats: caveatsForHash,
      salt,
    }

    const delegationHash = hashDelegation(delegation, chainId, delegationManagerAddr)

    return NextResponse.json({
      delegationHash,
      sessionId,
      delegation: { ...delegation, salt: salt.toString() },
      accountAddress,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bootstrap failed' },
      { status: 500 },
    )
  }
}
