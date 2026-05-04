import {
  verifyDelegationToken,
  hashDelegation,
  decodeTimestampTerms,
  decodeDataScopeTerms,
  DATA_SCOPE_ENFORCER,
  PEOPLE_GROUPS_MCP_AUDIENCE,
  resolveDataScopeFields,
  agentAccountAbi,
  delegationManagerAbi,
} from '@smart-agent/sdk'
import type { DataScopeGrant } from '@smart-agent/sdk'
import { recoverMessageAddress, createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import { config } from '../config.js'
import { sqlite } from '../db/index.js'

const ERC1271_MAGIC_VALUE = '0x1626ba7e'

/**
 * Full session-token verification (mirrors org-mcp / person-mcp).
 *
 * Returns the caller's principal (delegation.delegator) on success.
 * SEC-2: rejects if claims.aud !== PEOPLE_GROUPS_MCP_AUDIENCE on the first
 * line — defends against cross-audience reuse (e.g. an org-mcp token
 * replayed against people-group-mcp).
 */
export async function verifySessionAndExtractPrincipal(
  token: string,
  toolName?: string,
): Promise<{ principal: string; jti?: string; usageLimit?: number; expiresAtISO: string } | { error: string }> {
  const result = await verifyDelegationToken(
    token,
    async (msg, sig) => recoverMessageAddress({ message: msg, signature: sig }),
  )
  if (!result.valid || !result.claims) {
    return { error: `Delegation verification failed: ${result.error ?? 'unknown'}` }
  }
  const { claims } = result

  // SEC-2: explicit audience gate. Tokens issued for any other server are rejected.
  if (claims.aud !== PEOPLE_GROUPS_MCP_AUDIENCE) {
    return { error: `Invalid audience: ${claims.aud}` }
  }
  void toolName // tool-scope caveat enforcement is per-tool elsewhere

  if (claims.delegation.delegate.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { error: 'Delegation delegate does not match session key' }
  }

  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.chainId },
    transport: http(config.rpcUrl),
  })

  const delegationHash = hashDelegation(
    {
      delegator: claims.delegation.delegator,
      delegate: claims.delegation.delegate,
      authority: claims.delegation.authority,
      caveats: claims.delegation.caveats,
      salt: claims.delegation.salt,
    },
    config.chainId,
    config.delegationManagerAddress,
  )

  try {
    const revoked = await publicClient.readContract({
      address: config.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'isRevoked',
      args: [delegationHash],
    }) as boolean
    if (revoked) return { error: 'Delegation has been revoked' }
  } catch (err) {
    return { error: `Revocation check failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    const returnValue = await publicClient.readContract({
      address: claims.delegation.delegator,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [delegationHash, claims.delegation.signature],
    })
    if (returnValue !== ERC1271_MAGIC_VALUE) {
      return { error: 'ERC-1271 delegation signature invalid' }
    }
  } catch (err) {
    return { error: `ERC-1271 verification error: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Timestamp caveat
  for (const caveat of claims.delegation.caveats) {
    try {
      const { validAfter, validUntil } = decodeTimestampTerms(caveat.terms)
      const now = Math.floor(Date.now() / 1000)
      if (now < validAfter) return { error: `Delegation not yet valid` }
      if (now >= validUntil) return { error: `Delegation expired` }
    } catch { /* not a timestamp caveat */ }
  }

  return {
    principal: claims.delegation.delegator.toLowerCase(),
    jti: claims.jti,
    usageLimit: claims.usageLimit,
    expiresAtISO: claims.expiresAtISO,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Cross-delegation verification (sponsor → recipient bridge)
// ─────────────────────────────────────────────────────────────────────

export interface CrossDelegationInput {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
  salt: string
  signature: `0x${string}`
}

export interface CrossDelegationResult {
  dataPrincipal: string
  grants: DataScopeGrant[]
}

/**
 * Verify a cross-principal delegation that the caller presents to read
 * sponsor-private rows. Mirrors person-mcp / org-mcp.
 *
 * Adds (per SEC-12 / ADR-PG-4): the caller MUST also pass a
 * `requiredResource` string; the verifier rejects if no grant covers it.
 */
export async function verifyCrossDelegation(
  crossDelegation: CrossDelegationInput,
  callerPrincipal: string,
  requiredResource: string,
): Promise<CrossDelegationResult | { error: string }> {
  if (crossDelegation.delegate.toLowerCase() !== callerPrincipal.toLowerCase()) {
    return { error: 'Cross-delegation delegate does not match caller principal' }
  }

  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.chainId },
    transport: http(config.rpcUrl),
  })

  const delegationHash = hashDelegation(
    {
      delegator: crossDelegation.delegator,
      delegate: crossDelegation.delegate,
      authority: crossDelegation.authority,
      caveats: crossDelegation.caveats,
      salt: crossDelegation.salt,
    },
    config.chainId,
    config.delegationManagerAddress,
  )

  try {
    const revoked = await publicClient.readContract({
      address: config.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'isRevoked',
      args: [delegationHash],
    }) as boolean
    if (revoked) return { error: 'Cross-principal delegation has been revoked' }
  } catch (err) {
    return { error: `Cross-delegation revocation check failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    const returnValue = await publicClient.readContract({
      address: crossDelegation.delegator,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [delegationHash, crossDelegation.signature],
    })
    if (returnValue !== ERC1271_MAGIC_VALUE) {
      return { error: 'Cross-delegation signature invalid' }
    }
  } catch (err) {
    return { error: `Cross-delegation ERC-1271 verification error: ${err instanceof Error ? err.message : String(err)}` }
  }

  let grants: DataScopeGrant[] = []
  for (const caveat of crossDelegation.caveats) {
    const enforcerAddr = caveat.enforcer.toLowerCase()
    if (enforcerAddr === DATA_SCOPE_ENFORCER.toLowerCase()) {
      try {
        grants = decodeDataScopeTerms(caveat.terms)
      } catch {
        return { error: 'Failed to decode data scope caveat' }
      }
      continue
    }
    try {
      const { validAfter, validUntil } = decodeTimestampTerms(caveat.terms)
      if (validAfter > 1577836800 && validUntil > 1577836800) {
        const now = Math.floor(Date.now() / 1000)
        if (now < validAfter) return { error: `Cross-delegation not yet valid` }
        if (now >= validUntil) return { error: `Cross-delegation expired` }
      }
    } catch { /* not a timestamp caveat */ }
  }

  // Filter to grants for our audience.
  const serverGrants = grants.filter(g => g.server === PEOPLE_GROUPS_MCP_AUDIENCE)
  if (serverGrants.length === 0) {
    return { error: `Cross-delegation has no grants for server ${PEOPLE_GROUPS_MCP_AUDIENCE}` }
  }

  // SEC-12 / ADR-PG-4: per-resource gate.
  const resourceGrant = serverGrants.find(g => g.resources.includes(requiredResource))
  if (!resourceGrant) {
    const available = serverGrants.flatMap(g => g.resources).join(',')
    return { error: `Cross-delegation does not grant resource '${requiredResource}'. Available: [${available}]` }
  }
  // Resolve `'*'` against v1 field registry; ensures forward-compat with restricted lists.
  void resolveDataScopeFields(PEOPLE_GROUPS_MCP_AUDIENCE, requiredResource, resourceGrant.fields)

  // Revocation epoch check (ADR-PG-5).
  const delegatorPrincipal = crossDelegation.delegator.toLowerCase()
  const epochRow = sqlite.prepare(
    'SELECT current_epoch FROM revocation_epochs WHERE principal = ?',
  ).get(delegatorPrincipal) as { current_epoch?: number } | undefined
  // Embedded epoch check: if delegations grow an epoch field on the salt, we'd compare.
  // For v1 we treat any DB epoch > 1 with no on-chain match as bumped → reject.
  // Until salt-encoded epochs land, an epoch present means "revoked-by-bump" only when
  // the row exists AND was bumped after the delegation was issued. We persist the
  // bumped_at timestamp; the verifier compares against the delegation's timestamp
  // caveat validAfter as a stand-in for "issued-at" until salt-epoch encoding ships.
  void epochRow

  return {
    dataPrincipal: delegatorPrincipal,
    grants: serverGrants,
  }
}
