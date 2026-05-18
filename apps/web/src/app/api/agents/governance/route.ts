/** @sa-route web-auth @sa-auth session-cookie @sa-risk-tier high @sa-validation zod @sa-owner security */
/**
 * POST /api/agents/governance
 *
 * Governance plane writes for an agent: initialize the AgentControl
 * config, add an owner, or change the quorum. Each write is dispatched
 * to the on-chain `AgentControl` contract.
 *
 * AUTH MODEL (S2.7 / S3.4)
 * ------------------------
 * Before S3.4 this route accepted ANY POST from ANY origin and the
 * server signer minted the on-chain transaction. The senior review
 * (S2.7 inventory, risk-tier=high) flagged the absence of caller
 * auth — an attacker who knew the route path could rotate the owner
 * set of any agent on chain.
 *
 * The new auth chain is:
 *
 *   1. `requireOriginAllowed` (CSRF — S2.2). Reject any request that
 *      doesn't come from a configured browser origin.
 *   2. `getSession()` (web-auth). Reject any request without a valid
 *      session cookie with 401.
 *   3. Caller-MUST-be-able-to-govern. The signed-in user must control
 *      the agent being governed. We consider the caller authorized iff:
 *
 *        a. The session's smartAccountAddress IS the agent itself, OR
 *        b. The session's smartAccountAddress is recorded as an owner
 *           on the AgentControl contract for that agent, OR
 *        c. There is no AgentControl record yet for the agent AND the
 *           caller is requesting `initialize` (bootstrap path — the
 *           contract itself enforces `creator becomes first owner`).
 *
 *      Rule (a) covers the v0 demo path where a personal smart account
 *      is its own governance owner; (b) is the post-bootstrap path
 *      where multi-owner is set up; (c) lets a fresh account create
 *      its initial governance config without a chicken-and-egg.
 *
 * The server-held signer still issues the transaction (the smart
 * account doesn't have its own private key in dev). That's fine — the
 * authorisation check above moves the trust boundary from "anyone who
 * knows the URL" to "anyone with a valid session cookie for an account
 * that owns this agent". Production deployments will swap the server
 * signer for a delegation-redemption flow; that change does not
 * affect the auth check here.
 *
 * Body shape is validated by `validateRequest` against an action-typed
 * discriminated union. Invalid bodies → generic 400 (no schema leak —
 * S1.8 invariant).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAddress, isAddress } from 'viem'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { agentControlAbi } from '@smart-agent/sdk'
import { getSession } from '@/lib/auth/session'
import { requireOriginAllowed } from '@/lib/auth/csrf'
import { validateRequest, DEFAULT_BODY_LIMIT_BYTES } from '@/lib/auth/validate-request'
import { webErrorResponse } from '@/lib/auth/error-response'

// EIP-55 / hex-checked 0x address. Casts the string to viem's branded
// `0x${string}` AFTER `isAddress` returns true. `z.custom` keeps the
// check local to this schema so the validator helper stays generic.
const AddressSchema = z
  .string()
  .refine((s): s is `0x${string}` => isAddress(s), { message: 'invalid address' })

const InitializeSchema = z.object({
  action: z.literal('initialize'),
  agentAddress: AddressSchema,
  minOwners: z.coerce.bigint().nonnegative(),
  quorum: z.coerce.bigint().positive(),
})

const AddOwnerSchema = z.object({
  action: z.literal('addOwner'),
  agentAddress: AddressSchema,
  newOwner: AddressSchema,
})

const SetQuorumSchema = z.object({
  action: z.literal('setQuorum'),
  agentAddress: AddressSchema,
  newQuorum: z.coerce.bigint().positive(),
})

/**
 * Exported for unit tests. The route file is the single source of
 * truth for the body shape; the tests pin the discriminator + per-
 * action required fields so a future shape change can't silently
 * widen the contract.
 */
export const GovernanceBodySchema = z.discriminatedUnion('action', [
  InitializeSchema,
  AddOwnerSchema,
  SetQuorumSchema,
])

// Forbid (n)x larger payloads than a handful of address-bigint pairs.
// 4 KiB is generous (typical body ~250 B).
export const GOVERNANCE_BODY_LIMIT_BYTES = Math.min(4 * 1024, DEFAULT_BODY_LIMIT_BYTES)

/**
 * Read the on-chain owner set for `agent` (no throws — returns empty
 * on missing contract or revert). Caller decides what "no record"
 * means for the auth rule.
 */
async function readGovernanceOwners(
  controlAddr: `0x${string}`,
  agent: `0x${string}`,
): Promise<{ initialized: boolean; owners: readonly `0x${string}`[] }> {
  const publicClient = getPublicClient()
  try {
    const initialized = await publicClient.readContract({
      address: controlAddr, abi: agentControlAbi,
      functionName: 'isInitialized', args: [agent],
    }) as boolean
    if (!initialized) return { initialized: false, owners: [] }
    const owners = await publicClient.readContract({
      address: controlAddr, abi: agentControlAbi,
      functionName: 'getOwners', args: [agent],
    }) as `0x${string}`[]
    return { initialized: true, owners }
  } catch {
    return { initialized: false, owners: [] }
  }
}

/**
 * Decide whether `caller` may execute `action` against `agent`. See
 * the auth model at the top of the file. Returns `null` on allow, or
 * a `NextResponse` (403) on deny.
 *
 * Exported for unit tests — the policy is the whole point of S2.7's
 * governance gap and worth covering directly.
 */
export function checkAuthorization(args: {
  caller: `0x${string}` | null
  agent: `0x${string}`
  action: 'initialize' | 'addOwner' | 'setQuorum'
  initialized: boolean
  owners: readonly `0x${string}`[]
}): NextResponse | null {
  const { caller, agent, action, initialized, owners } = args
  if (!caller) {
    return NextResponse.json({ error: 'session has no smart account' }, { status: 403 })
  }
  const callerLc = caller.toLowerCase()
  // Rule (a): self-governance.
  if (callerLc === agent.toLowerCase()) return null
  // Rule (b): caller is a registered owner.
  if (initialized && owners.some((o) => o.toLowerCase() === callerLc)) return null
  // Rule (c): bootstrap exception — only for `initialize`.
  if (action === 'initialize' && !initialized) return null
  return NextResponse.json({ error: 'not authorized to govern this agent' }, { status: 403 })
}

export async function POST(request: Request) {
  // 1. CSRF.
  const csrfDenied = requireOriginAllowed(request)
  if (csrfDenied) return csrfDenied

  // 2. Session.
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 3. Body validation (size + shape).
  const parsed = await validateRequest(request, {
    schema: GovernanceBodySchema,
    maxBytes: GOVERNANCE_BODY_LIMIT_BYTES,
  })
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}` | undefined
  if (!controlAddr) {
    return NextResponse.json({ error: 'AgentControl not deployed' }, { status: 503 })
  }

  const agent = getAddress(body.agentAddress)

  // 4. Authorisation — caller must control this agent.
  const callerSmartAccount =
    (session.smartAccountAddress ?? session.walletAddress) as `0x${string}` | null
  const { initialized, owners } = await readGovernanceOwners(controlAddr, agent)
  const authDenied = checkAuthorization({
    caller: callerSmartAccount,
    agent,
    action: body.action,
    initialized,
    owners,
  })
  if (authDenied) return authDenied

  // 5. Dispatch the write. Server signer issues the on-chain transaction.
  try {
    const walletClient = getWalletClient()
    const publicClient = getPublicClient()

    if (body.action === 'initialize') {
      const hash = await walletClient.writeContract({
        address: controlAddr,
        abi: agentControlAbi,
        functionName: 'initializeAgent',
        args: [agent, body.minOwners, body.quorum],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'addOwner') {
      const hash = await walletClient.writeContract({
        address: controlAddr,
        abi: agentControlAbi,
        functionName: 'addOwner',
        args: [agent, getAddress(body.newOwner)],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return NextResponse.json({ success: true })
    }

    // body.action === 'setQuorum' (exhaustive — discriminated union).
    const hash = await walletClient.writeContract({
      address: controlAddr,
      abi: agentControlAbi,
      functionName: 'setQuorum',
      args: [agent, body.newQuorum],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    return NextResponse.json({ success: true })
  } catch (error) {
    // Never leak the underlying revert message — it can carry calldata or
    // RPC URLs (S1.8 invariant).
    return webErrorResponse({
      publicMessage: 'Governance write failed',
      logMessage: '[agents/governance] write failed',
      logFields: {
        action: body.action,
        agentAddress: agent,
        callerSmartAccount,
        errorCode: 'governance-write-failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
      status: 500,
      request,
    })
  }
}
