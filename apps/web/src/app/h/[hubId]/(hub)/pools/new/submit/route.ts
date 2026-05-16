/**
 * POST /h/[hubId]/pools/new/submit — pool create handler.
 *
 * Authenticates the viewer, calls createPool() server action, returns
 * the new pool agent id + treasury address. Sibling-dir to the page to
 * avoid the Next 15 same-dir 405 footgun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { createPool, type CreatePoolInput } from '@/lib/actions/poolCreate.action'
import type { Address } from 'viem'

export const dynamic = 'force-dynamic'

interface IncomingBody extends Partial<CreatePoolInput> {
  operatingOrg?: Address
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ ok: false, error: 'not-authenticated' }, { status: 401 })
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) return NextResponse.json({ ok: false, error: 'no-person-agent' }, { status: 400 })

  let body: IncomingBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.id || !body.name || !body.domain || !body.mandate || !body.governanceModel
      || !body.acceptedRestrictions || !body.acceptedUnits || !body.ceilingPolicy
      || !body.visibility || !body.operatingOrg) {
    return NextResponse.json(
      { ok: false, error: 'missing required fields (operatingOrg required — pools are governed by an organisation)' },
      { status: 400 },
    )
  }

  // Caller must be an owner/steward of the operating org. The pool will
  // inherit the org's ownership; allowing strangers to anchor a pool to
  // an org they don't govern would let them hijack that org's funds.
  const canManageOrg = await canManageAgent(myAgent, body.operatingOrg)
  if (!canManageOrg) {
    return NextResponse.json({ ok: false, error: 'not-authorized-on-operating-org' }, { status: 403 })
  }

  try {
    const result = await createPool({
      id: body.id,
      name: body.name,
      domain: body.domain,
      mandate: body.mandate,
      governanceModel: body.governanceModel,
      acceptedRestrictions: body.acceptedRestrictions,
      acceptedUnits: body.acceptedUnits,
      capacityCeiling: body.capacityCeiling,
      ceilingPolicy: body.ceilingPolicy,
      visibility: body.visibility,
      addressedMembers: body.addressedMembers,
      // The operating org is the sole steward — the pool body field used
      // for display + discovery. On-chain ownership is added below.
      stewards: [body.operatingOrg],
    })

    // Add the org's AgentAccount as an on-chain owner of the freshly
    // deployed pool agent. After this, any caller who is an owner of the
    // org (or the org itself acting as msg.sender) passes
    // `_isAccountOwner(poolAgent, ...)` on every round-admin / pool-admin
    // write. This is what enforces the unified governance rule.
    //
    // We ALSO add the creating steward's EOA as a direct owner. This is
    // what lets the steward sign Rail-A release delegations (donor pool →
    // steward EOA) at tranche-release time. AgentAccount.isValidSignature
    // only resolves ERC-1271 signatures against EOAs in its direct owner
    // set (no recursive contract-owner walk); without this grant, the
    // steward's signature recovers to an EOA that the pool doesn't
    // recognise and DelegationManager._validateSignature reverts with
    // InvalidSignature() (selector 0x8baa579f). Bootstrap-time deployer
    // signing here is the canonical pattern (same as the org grant above)
    // — runtime release never touches the deployer key.
    try {
      const { grantOrgOwnershipBatch } = await import('@/lib/demo-seed/grant-org-ownership')
      const grants = [{
        orgAddress: result.treasuryAddress,
        userSmartAccount: body.operatingOrg,
        label: `${body.name} ← anchored to org ${body.operatingOrg.slice(0, 8)}`,
      }]
      // Demo / EOA users have `user.walletAddress !== smartAccountAddress`
      // — the wallet IS their signing EOA. Add it as a pool owner so the
      // Rail-A release path's ERC-1271 ECDSA check accepts their sig.
      // For passkey/SIWE users the wallet field aliases the smart account
      // (no EOA key on the server); the existing deployer-fallback in
      // `loadSignerForCurrentUser` covers that case, so we skip adding
      // the smart-account-as-EOA-owner (it'd be a contract address, not
      // an EOA — irrelevant to the _verifyEcdsa path).
      if (user.walletAddress
          && user.smartAccountAddress
          && user.walletAddress.toLowerCase() !== user.smartAccountAddress.toLowerCase()) {
        grants.push({
          orgAddress: result.treasuryAddress,
          userSmartAccount: user.walletAddress as Address,
          label: `${body.name} ← steward EOA ${user.walletAddress.slice(0, 8)}`,
        })
      }
      await grantOrgOwnershipBatch(grants)
    } catch (err) {
      console.warn('[pools/new] failed to add steward / org owners (pool will still exist with deployer-only ownership):', err)
    }

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The MCP layer returns "No active agent session" / "Session expired"
    // when the user hasn't bootstrapped their A2A delegation yet (common
    // for freshly-connected non-demo users who skipped the /h/<hub>
    // onboarding wizard, OR for users whose a2a-session cookie is stale
    // after a service restart). Map to a clean 401 + redirect hint so
    // the form can surface "complete onboarding to continue" instead of
    // a generic 500.
    const sessionMissing =
      message.includes('No active agent session') ||
      message.includes('Session expired') ||
      message.includes('Invalid or expired session token') ||
      message.includes('No A2A session')
    if (sessionMissing) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Your agent session isn\'t set up yet. Finish onboarding at /h/' + (req.nextUrl?.pathname?.split('/')[2] ?? 'catalyst') + ' to bootstrap your agent, then try again.',
          redirectTo: '/h/' + (req.nextUrl?.pathname?.split('/')[2] ?? 'catalyst'),
        },
        { status: 401 },
      )
    }
    console.error('[pools/new/submit] failed:', err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
