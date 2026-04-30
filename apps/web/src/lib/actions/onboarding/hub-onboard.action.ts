'use server'

/**
 * Hub-context onboarding actions.
 *
 * The new flow lives entirely on /h/{slug}. A single state machine drives:
 *   connect → profile → register → name → join → done
 *
 * Each step is a server action that mutates the user's state and the client
 * re-fetches getHubOnboardingState() to figure out what's left.
 *
 * Membership is implicit: the URL's hub is what gets joined. Users can
 * accumulate memberships in multiple hubs by visiting each /h/{slug}.
 */

import { getAddress } from 'viem'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'
import { getPublicClient, getEdgesBySubject, getEdge } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  ATL_PRIMARY_NAME,
  HAS_MEMBER,
} from '@smart-agent/sdk'

export type OnboardStep = 'connect' | 'profile' | 'register' | 'name' | 'join' | 'org' | 'done'

export interface HubOnboardingState {
  /** Step the wizard should render right now. */
  step: OnboardStep
  authenticated: boolean
  via?: 'demo' | 'passkey' | 'siwe' | 'google' | null
  /** Pre-fill values for the profile form. */
  currentName: string
  currentEmail: string
  /** Per-step readiness flags (used for audit / debugging). */
  profileComplete: boolean
  agentRegistered: boolean
  hasAgentName: boolean
  primaryName?: string
  isMember: boolean
  smartAccountAddress?: string | null
  /** Hub display info for the UI. */
  hub: {
    address: string
    primaryName: string
    displayName: string
  }
}

const HAS_MEMBER_HEX = (HAS_MEMBER as string).toLowerCase()

/**
 * Resolve current onboarding state for the user against the given hub.
 *
 * Rules:
 *   - Unauthenticated → step='connect'.
 *   - Profile incomplete (placeholder name OR missing email) → step='profile'.
 *   - Agent not on AgentAccountResolver → step='register'.
 *   - No ATL_PRIMARY_NAME (and no DB mirror) → step='name'.
 *   - Not a HAS_MEMBER of this hub → step='join'.
 *   - Else → step='done'.
 */
export async function getHubOnboardingState(hubAddressInput: string): Promise<HubOnboardingState> {
  const hubAddress = getAddress(hubAddressInput as `0x${string}`)
  const hubMeta = await readHubMeta(hubAddress)

  const session = await getSession()
  if (!session) {
    return baseState('connect', { hub: hubMeta })
  }

  const user = await db.select().from(schema.users)
    .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])

  if (!user) {
    return baseState('connect', { hub: hubMeta, authenticated: true, via: session.via })
  }

  // 1. Profile complete? (Same logic as setup-agent.action.ts: reject the
  // placeholder names that auth flows seed.)
  const placeholderName =
    !user.name || user.name === 'Agent User' || user.name.startsWith('Wallet ')
  const profileComplete = !placeholderName && !!user.email

  if (!profileComplete) {
    return {
      step: 'profile',
      authenticated: true,
      via: session.via,
      currentName: placeholderName ? '' : (user.name ?? ''),
      currentEmail: user.email ?? '',
      profileComplete: false,
      agentRegistered: false,
      hasAgentName: false,
      isMember: false,
      smartAccountAddress: user.smartAccountAddress ?? null,
      hub: hubMeta,
    }
  }

  // 2. Agent registered on AgentAccountResolver?
  //
  // Demo + production users carry TWO distinct on-chain addresses:
  //   • `smart_account_address` — the wallet's UserOp target (session/auth)
  //   • `person_agent_address`  — the registered agent in the trust graph
  //
  // The seed and production agent-registration flow both write the
  // *person agent* into the resolver, never the wallet smart account.
  // Earlier this check used `smart_account_address` exclusively, which
  // returned `false` for every user with a properly-registered person
  // agent — leaving them stuck on "Setting up your agent / Preparing…"
  // forever. Now we check person-agent first and fall back to smart
  // account for legacy accounts that still register the wallet itself.
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  const personAgent = user.personAgentAddress as `0x${string}` | null
  const smartAcct = user.smartAccountAddress as `0x${string}` | null
  let agentRegistered = false
  let onChainPrimaryName = ''
  if (resolverAddr && (personAgent || smartAcct)) {
    const candidates = [personAgent, smartAcct].filter((a): a is `0x${string}` => !!a)
    try {
      const client = getPublicClient()
      for (const addr of candidates) {
        const reg = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'isRegistered', args: [getAddress(addr)],
        }) as boolean
        if (reg) {
          agentRegistered = true
          onChainPrimaryName = await client.readContract({
            address: resolverAddr, abi: agentAccountResolverAbi,
            functionName: 'getStringProperty',
            args: [getAddress(addr), ATL_PRIMARY_NAME as `0x${string}`],
          }) as string
          break
        }
      }
    } catch { /* registry unavailable */ }
  }

  if (!agentRegistered) {
    return {
      step: 'register',
      authenticated: true,
      via: session.via,
      currentName: user.name ?? '',
      currentEmail: user.email ?? '',
      profileComplete: true,
      agentRegistered: false,
      hasAgentName: false,
      isMember: false,
      smartAccountAddress: smartAcct,
      hub: hubMeta,
    }
  }

  // 3. .agent name set? Prefer on-chain, fall back to DB mirror.
  const primaryName = onChainPrimaryName || user.agentName || ''
  const hasAgentName = !!primaryName

  if (!hasAgentName) {
    return {
      step: 'name',
      authenticated: true,
      via: session.via,
      currentName: user.name ?? '',
      currentEmail: user.email ?? '',
      profileComplete: true,
      agentRegistered: true,
      hasAgentName: false,
      isMember: false,
      smartAccountAddress: smartAcct,
      hub: hubMeta,
    }
  }

  // 4. Membership in THIS hub?
  // HAS_MEMBER edges in the seed point at the person agent (the on-chain
  // identity registered in the resolver), not the wallet smart account. Check
  // person agent first; fall back to smart account for legacy users where
  // the wallet was registered directly.
  let isMember = await isMemberOfHub(hubAddress, personAgent)
  if (!isMember && smartAcct && smartAcct !== personAgent) {
    isMember = await isMemberOfHub(hubAddress, smartAcct as `0x${string}`)
  }

  if (!isMember) {
    return {
      step: 'join',
      authenticated: true,
      via: session.via,
      currentName: user.name ?? '',
      currentEmail: user.email ?? '',
      profileComplete: true,
      agentRegistered: true,
      hasAgentName: true,
      primaryName,
      isMember: false,
      smartAccountAddress: smartAcct,
      hub: hubMeta,
    }
  }

  // 5. Member of at least one org under this hub? Avoids stranding users
  // without an org affiliation — every hub member operates under one.
  const { currentUserOrgInHub } = await import('@/lib/actions/onboarding/org-onboard.action')
  const hasOrg = await currentUserOrgInHub(hubAddress).catch(() => false)
  if (!hasOrg) {
    return {
      step: 'org',
      authenticated: true,
      via: session.via,
      currentName: user.name ?? '',
      currentEmail: user.email ?? '',
      profileComplete: true,
      agentRegistered: true,
      hasAgentName: true,
      primaryName,
      isMember: true,
      smartAccountAddress: smartAcct,
      hub: hubMeta,
    }
  }

  return {
    step: 'done',
    authenticated: true,
    via: session.via,
    currentName: user.name ?? '',
    currentEmail: user.email ?? '',
    profileComplete: true,
    agentRegistered: true,
    hasAgentName: true,
    primaryName,
    isMember: true,
    smartAccountAddress: smartAcct,
    hub: hubMeta,
  }
}

async function readHubMeta(hubAddress: `0x${string}`) {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) {
    return { address: hubAddress, primaryName: '', displayName: '' }
  }
  const client = getPublicClient()
  try {
    const core = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getCore',
      args: [hubAddress],
    }) as { agentType: `0x${string}`; displayName: string; description: string; active: boolean }
    let primaryName = ''
    try {
      primaryName = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [hubAddress, ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
    } catch { /* */ }
    return {
      address: hubAddress,
      primaryName,
      displayName: core.displayName || primaryName,
    }
  } catch {
    return { address: hubAddress, primaryName: '', displayName: '' }
  }
}

async function isMemberOfHub(hubAddress: `0x${string}`, personAgent: `0x${string}` | null): Promise<boolean> {
  if (!personAgent) return false
  // HAS_MEMBER edges are written with subject=hub, so we walk the hub's
  // outgoing edges and check whether any point at the user's person agent.
  try {
    const edges = await getEdgesBySubject(hubAddress)
    for (const id of edges) {
      try {
        const edge = await getEdge(id)
        if (!edge) continue
        if ((edge.relationshipType ?? '').toLowerCase() !== HAS_MEMBER_HEX) continue
        if (edge.object_.toLowerCase() === personAgent.toLowerCase()) return true
      } catch { /* edge read failed; skip */ }
    }
  } catch { /* relationship registry unavailable */ }
  return false
}

function baseState(step: OnboardStep, opts: {
  hub: HubOnboardingState['hub']
  authenticated?: boolean
  via?: HubOnboardingState['via']
}): HubOnboardingState {
  return {
    step,
    authenticated: opts.authenticated ?? false,
    via: opts.via ?? null,
    currentName: '',
    currentEmail: '',
    profileComplete: false,
    agentRegistered: false,
    hasAgentName: false,
    isMember: false,
    smartAccountAddress: null,
    hub: opts.hub,
  }
}

