import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { AgentSession, CreateSessionParams, SessionPackage, Caveat, DeployedContracts } from '@smart-agent/types'
import { DelegationClient, encodeTimestampTerms, buildCaveat } from './delegation'

/**
 * Create an agent session — generates a session key and issues a
 * delegation from the root agent account with time-bounded caveats.
 */
export async function createAgentSession(params: {
  createSessionParams: CreateSessionParams
  delegationClient: DelegationClient
  chainId: number
  timestampEnforcerAddress: `0x${string}`
}): Promise<SessionPackage> {
  const { createSessionParams, delegationClient, chainId, timestampEnforcerAddress } = params

  // 1. Generate session key
  const sessionPrivateKey = generatePrivateKey()
  const sessionAccount = privateKeyToAccount(sessionPrivateKey)

  // 2. Build caveats — always include time expiry
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + createSessionParams.durationSeconds

  const timeCaveat = buildCaveat(
    timestampEnforcerAddress,
    encodeTimestampTerms(now, expiresAt),
  )

  const allCaveats: Caveat[] = [timeCaveat, ...createSessionParams.caveats]

  // 3. Issue delegation
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
  const delegation = await delegationClient.issueDelegation({
    delegator: createSessionParams.rootAccount,
    delegate: sessionAccount.address,
    caveats: allCaveats,
    salt,
  })

  // 4. Package
  const session: AgentSession = {
    id: crypto.randomUUID(),
    rootAccount: createSessionParams.rootAccount,
    sessionKey: sessionAccount.address,
    sessionPrivateKey,
    caveats: allCaveats,
    expiresAt: new Date(expiresAt * 1000),
    status: 'active',
    createdAt: new Date(),
  }

  return { session, chainId, delegations: [delegation] }
}

/** Check if a session is still valid. */
export function isSessionValid(session: AgentSession): boolean {
  if (session.status !== 'active') return false
  return new Date() < session.expiresAt
}
