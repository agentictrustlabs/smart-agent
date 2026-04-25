'use server'

/**
 * Onboarding actions for non-demo users (Google / SIWE / passkey).
 *
 *   - getOnboardingStatus()         — what's still missing for the current user.
 *   - ensurePersonAgentRegistered() — idempotent: registers the user's smart
 *                                     account in AgentAccountResolver as a
 *                                     `person` agent and adds the wallet as
 *                                     a controller. Safe to re-run.
 *   - listHubsForOnboarding()       — on-chain hubs the user can pick to
 *                                     register a sub-name under (e.g. for
 *                                     `joe.catalyst.agent`).
 *   - registerPersonalAgentName()   — registers `<label>.agent` (root) or
 *                                     `<label>.<parentName>.agent` (sub) in
 *                                     AgentNameRegistry, sets the resolver
 *                                     addr record, and writes
 *                                     ATL_PRIMARY_NAME + ATL_NAME_LABEL.
 */

import { getAddress, keccak256, toBytes, encodePacked, type PublicClient } from 'viem'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { addAgentController } from '@/lib/agent-resolver'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import {
  agentAccountResolverAbi,
  agentNameRegistryAbi,
  agentNameResolverAbi,
  ATL_PRIMARY_NAME,
  ATL_NAME_LABEL,
  TYPE_HUB,
  AGENT_TLD,
  normalize,
  namehash,
} from '@smart-agent/sdk'

interface OnboardingStatus {
  authenticated: boolean
  via?: 'demo' | 'passkey' | 'siwe' | 'google' | null
  walletAddress?: string | null
  smartAccountAddress?: string | null
  /** True when DB user.name is non-empty AND not the placeholder 'Agent User'. */
  profileComplete: boolean
  /** True when the smart account is registered + active in AgentAccountResolver. */
  agentRegistered: boolean
  /** True when ATL_PRIMARY_NAME is set on the account. */
  hasAgentName: boolean
  /**
   * True once the user has completed the wizard end-to-end (regardless of
   * downstream on-chain write success). The (authenticated) layout uses this
   * as the master gate to avoid bouncing stuck-state users back into
   * onboarding.
   */
  onboardedAt?: string | null
  primaryName?: string
}

/**
 * Return the current user's onboarding state. Used by the (authenticated)
 * layout guard and by the onboarding wizard itself to decide which step to
 * land on.
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  let session
  try { session = await requireSession() } catch {
    return { authenticated: false, profileComplete: false, agentRegistered: false, hasAgentName: false }
  }
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.privyUserId, session.userId)).limit(1).then(r => r[0])
  if (!user) {
    return {
      authenticated: true, via: session.via, walletAddress: session.walletAddress,
      profileComplete: false, agentRegistered: false, hasAgentName: false,
    }
  }
  const profileComplete = !!user.name && user.name !== 'Agent User'

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  const smartAcct = user.smartAccountAddress as `0x${string}` | null
  let agentRegistered = false
  let onChainPrimaryName = ''
  if (resolverAddr && smartAcct) {
    try {
      const client = getPublicClient()
      const isReg = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [getAddress(smartAcct)],
      }) as boolean
      agentRegistered = isReg
      if (isReg) {
        onChainPrimaryName = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [getAddress(smartAcct), ATL_PRIMARY_NAME as `0x${string}`],
        }) as string
      }
    } catch { /* registry unavailable */ }
  }

  // Prefer the on-chain primary name; fall back to the DB mirror written by
  // registerPersonalAgentName for accounts where the resolver write was
  // skipped (legacy stuck-state accounts).
  const primaryName = onChainPrimaryName || user.agentName || ''

  return {
    authenticated: true,
    via: session.via,
    walletAddress: user.walletAddress,
    smartAccountAddress: smartAcct,
    profileComplete,
    agentRegistered,
    hasAgentName: !!primaryName,
    primaryName: primaryName || undefined,
    onboardedAt: user.onboardedAt ?? null,
  }
}

/**
 * Marks the current user as onboarded. Called by the wizard at the end of
 * the choose step. Idempotent; subsequent calls are no-ops.
 */
export async function markOnboardingComplete(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSession()
    await db.update(schema.users)
      .set({ onboardedAt: new Date().toISOString() })
      .where(eq(schema.users.privyUserId, session.userId))
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'mark complete failed' }
  }
}

/**
 * Escape hatch for users whose smart account is unrecoverably stuck — e.g.
 * Phase 2 already removed the bootstrap server, the original passkey is
 * gone, and the on-chain recovery delegation can't be redeemed. Bumps the
 * user's salt rotation, clears per-account DB state, and signs them out.
 * Their next Google login deploys a brand-new smart account at a fresh
 * deterministic address.
 *
 * On-chain artifacts at the old address are NOT deleted (we can't); they
 * just become unreferenced. The user starts onboarding from zero.
 */
export async function startFreshAccount(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSession()
    if (session.via !== 'google') {
      return { success: false, error: 'Start-fresh is currently OAuth-only' }
    }
    const user = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1).then(r => r[0])
    if (!user) return { success: false, error: 'user not found' }
    if (!user.email) return { success: false, error: 'user has no email on file' }

    const { privateKeyToAccount } = await import('viem/accounts')
    const { getSmartAccountAddress } = await import('@/lib/contracts')
    const { deriveSaltFromEmail } = await import('@/lib/auth/google-oauth')
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
    if (!deployerKey) return { success: false, error: 'DEPLOYER_PRIVATE_KEY not configured' }
    const serverEOA = privateKeyToAccount(deployerKey).address as `0x${string}`

    const newRotation = (user.accountSaltRotation ?? 0) + 1
    const newSalt = deriveSaltFromEmail(user.email, newRotation)
    const newAddr = await getSmartAccountAddress(serverEOA, newSalt)
    const newAddrLower = newAddr.toLowerCase() as `0x${string}`

    // Delete per-account artifacts that won't apply to the fresh account.
    if (user.smartAccountAddress) {
      await db.delete(schema.recoveryDelegations)
        .where(eq(schema.recoveryDelegations.accountAddress, user.smartAccountAddress.toLowerCase()))
    }
    await db.delete(schema.passkeys).where(eq(schema.passkeys.userId, user.id))

    await db.update(schema.users).set({
      accountSaltRotation: newRotation,
      smartAccountAddress: newAddrLower,
      walletAddress: newAddrLower,
      agentName: null,
      onboardedAt: null,
      personAgentAddress: null,
    }).where(eq(schema.users.id, user.id))

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'start-fresh failed' }
  }
}

/**
 * Idempotent: ensure the current user's smart account is registered as a
 * person agent in AgentAccountResolver.
 *
 *   - If the agent is already registered, no-op (we deliberately do NOT call
 *     `updateCore`, since for accounts that have already removed the bootstrap
 *     server from `_owners` (Phase 2), the resolver's onlyAgentOwner modifier
 *     would revert with NotAgentOwner / 0x390772fc).
 *   - If the smart account doubles as the wallet address (true for OAuth
 *     users — there's no separate EOA), we skip `addAgentController` since
 *     adding the agent as its own controller is semantically meaningless and
 *     also reverts with the same NotAgentOwner check.
 */
export async function ensurePersonAgentRegistered(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSession()
    if (session.via === 'demo') return { success: true } // demo agents are seeded.

    const user = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1).then(r => r[0])
    if (!user) return { success: false, error: 'user row missing' }
    if (!user.smartAccountAddress) return { success: false, error: 'no smart account on user row' }

    const smartAcct = getAddress(user.smartAccountAddress as `0x${string}`)

    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!resolverAddr) return { success: false, error: 'AGENT_ACCOUNT_RESOLVER_ADDRESS not set' }
    const client = getPublicClient()

    // Idempotency check — already registered? Done.
    const alreadyRegistered = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'isRegistered', args: [smartAcct],
    }) as boolean

    if (!alreadyRegistered) {
      const displayName = user.name && user.name !== 'Agent User'
        ? user.name
        : (user.email ?? 'New User')
      await registerAgentMetadata({
        agentAddress: smartAcct,
        displayName,
        description: '',
        agentType: 'person',
      })
    }

    // For OAuth users, walletAddress === smartAccountAddress (no separate EOA);
    // adding the agent as its own controller reverts with NotAgentOwner and
    // adds no useful signal anyway. Skip it.
    if (
      user.walletAddress &&
      user.walletAddress.toLowerCase().startsWith('0x') &&
      user.walletAddress.toLowerCase() !== smartAcct.toLowerCase()
    ) {
      const ownerAddr = getAddress(user.walletAddress as `0x${string}`)
      try {
        await addAgentController(smartAcct, ownerAddr)
      } catch (e) {
        // The bootstrap server may have already been removed from _owners
        // (Phase 2). The agent is still registered; treat the controller
        // write as a non-fatal best-effort.
        console.warn('[onboarding] addAgentController skipped:', (e as Error).message)
      }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'register failed' }
  }
}

interface HubChoice {
  address: string
  primaryName: string   // e.g. "catalyst.agent"
  displayName: string   // resolver displayName for the dropdown
  /** namehash of `primaryName` — the parent node for sub-name registrations. */
  parentNode: `0x${string}`
}

/**
 * Discover hub agents the user can register a sub-name under. Filters to hubs
 * that already have ATL_PRIMARY_NAME set, since the parent must exist in the
 * AgentNameRegistry before we can register a child.
 */
export async function listHubsForOnboarding(): Promise<HubChoice[]> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return []
  const client = getPublicClient()
  try {
    const count = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount',
    }) as bigint
    const idxs = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
    const addrs = await Promise.all(idxs.map(i =>
      client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [i] }) as Promise<`0x${string}`>,
    ))
    const cores = await Promise.all(addrs.map(a =>
      client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [a] }) as Promise<{ agentType: `0x${string}`; displayName: string; active: boolean }>,
    ))
    const hubs: HubChoice[] = []
    for (let i = 0; i < addrs.length; i++) {
      const c = cores[i]
      if (!c.active || c.agentType !== TYPE_HUB) continue
      const primaryName = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty',
        args: [addrs[i], ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
      if (!primaryName) continue
      hubs.push({
        address: addrs[i],
        primaryName,
        displayName: c.displayName || primaryName,
        parentNode: namehash(primaryName),
      })
    }
    hubs.sort((a, b) => a.primaryName.localeCompare(b.primaryName))
    return hubs
  } catch {
    return []
  }
}

interface RegisterNameInput {
  /** The label the user picked. Must be normalised (lowercase alnum + hyphens). */
  label: string
  /** Full parent name, e.g. "catalyst.agent". Omit for root (`<label>.agent`). */
  parentName?: string
}

/**
 * Register a `.agent` name for the current user's smart account.
 *
 * Tx sequence (deployer-signed):
 *   1. AgentNameRegistry.register(parentNode, label, accountAddr, resolver, 0)
 *   2. AgentNameResolver.setAddr(childNode, accountAddr)
 *   3. AgentAccountResolver.setStringProperty(accountAddr, ATL_NAME_LABEL, label)
 *   4. AgentAccountResolver.setStringProperty(accountAddr, ATL_PRIMARY_NAME, fullName)
 */
export async function registerPersonalAgentName(input: RegisterNameInput): Promise<{ success: boolean; error?: string; fullName?: string; warnings?: string[] }> {
  try {
    const session = await requireSession()
    if (session.via === 'demo') return { success: false, error: 'demo users have seeded names; not registerable here' }

    const user = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1).then(r => r[0])
    if (!user?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }
    const accountAddr = getAddress(user.smartAccountAddress as `0x${string}`)

    let label: string
    try { label = normalize(input.label) } catch (e) {
      return { success: false, error: (e as Error).message }
    }

    const nameRegistry = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}` | undefined
    const nameResolver = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}` | undefined
    const accountResolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!nameRegistry || !nameResolver || !accountResolver) {
      return { success: false, error: 'agent naming contracts not configured' }
    }

    const wallet = getWalletClient()
    const pub = getPublicClient()

    // Compute parent + full name.
    let parentNode: `0x${string}`
    let fullName: string
    if (input.parentName) {
      const parentNorm = normalize(input.parentName)
      parentNode = namehash(parentNorm)
      fullName = `${label}.${parentNorm}`
    } else {
      // Root TLD: parent = namehash("agent")
      parentNode = namehash(AGENT_TLD)
      fullName = `${label}.${AGENT_TLD}`
    }

    // Idempotency: if the child already exists under that parent and resolves
    // to this account, treat as already-registered.
    const childLabelhash = keccak256(toBytes(label))
    const childNode = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, childLabelhash]))
    const exists = await pub.readContract({
      address: nameRegistry, abi: agentNameRegistryAbi, functionName: 'recordExists', args: [childNode],
    }) as boolean
    if (exists) {
      const owner = await pub.readContract({
        address: nameRegistry, abi: agentNameRegistryAbi, functionName: 'owner', args: [childNode],
      }) as `0x${string}`
      if (owner.toLowerCase() !== accountAddr.toLowerCase()) {
        return { success: false, error: `name "${fullName}" already taken by another agent` }
      }
      // Already ours — fall through and just (re)set the metadata; resilient
      // against partial-state from a previous failed attempt.
    } else {
      const h = await wallet.writeContract({
        address: nameRegistry, abi: agentNameRegistryAbi, functionName: 'register',
        args: [parentNode, label, accountAddr, nameResolver, 0n],
      })
      await pub.waitForTransactionReceipt({ hash: h })
    }

    // Resolver writes: each one checks `accountAddr.isOwner(deployer)`. If
    // the bootstrap server has already been removed from _owners (legacy
    // accounts that went through the old Phase-2 removal), these revert with
    // NotAuthorized / NotAgentOwner. The registry record (above) is the
    // canonical source-of-truth for the name; the resolver records are an
    // index. We treat resolver write failures as recoverable so the user
    // gets through onboarding; Phase 4 (passkey-signed resolver writes) will
    // backfill these for accounts that hit this path.
    const writeWarnings: string[] = []
    const tolerant = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn() } catch (e) {
        const msg = (e as Error).message?.split('\n')[0] ?? String(e)
        console.warn(`[onboarding/name] ${label} failed (non-fatal): ${msg}`)
        writeWarnings.push(`${label}: ${msg}`)
      }
    }

    await tolerant('setAddr', async () => {
      const h = await wallet.writeContract({
        address: nameResolver, abi: agentNameResolverAbi, functionName: 'setAddr',
        args: [childNode, accountAddr],
      })
      await pub.waitForTransactionReceipt({ hash: h })
    })
    await tolerant('setStringProperty(NAME_LABEL)', async () => {
      const h = await wallet.writeContract({
        address: accountResolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty',
        args: [accountAddr, ATL_NAME_LABEL as `0x${string}`, label],
      })
      await pub.waitForTransactionReceipt({ hash: h })
    })
    await tolerant('setStringProperty(PRIMARY_NAME)', async () => {
      const h = await wallet.writeContract({
        address: accountResolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty',
        args: [accountAddr, ATL_PRIMARY_NAME as `0x${string}`, fullName],
      })
      await pub.waitForTransactionReceipt({ hash: h })
    })

    // Mirror the chosen name into the DB so onboarding status has a stable
    // signal even when the on-chain resolver write was skipped (legacy
    // accounts where the server is no longer in _owners).
    await db.update(schema.users).set({ agentName: fullName }).where(eq(schema.users.id, user.id))

    return { success: true, fullName, warnings: writeWarnings.length ? writeWarnings : undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'name registration failed' }
  }
}

// Mark `client` as used so TS doesn't complain about the type-only re-export.
void (null as unknown as PublicClient)
