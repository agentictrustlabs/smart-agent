'use server'

import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'
import { OnChainResolver } from '@smart-agent/credential-registry'
import { getPublicClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  ATL_PRIMARY_NAME,
  ATL_CONTROLLER,
  TYPE_ORGANIZATION,
} from '@smart-agent/sdk'

export interface CredentialRow {
  id: string
  walletContext: string
  issuerId: string
  schemaId: string
  credDefId: string
  credentialType: string
  receivedAt: string
  status: string
  /** On-chain presence: schema + credDef both published under expected ids. */
  anchored: boolean | null
  /** Issuer agent's 0x-address parsed from did:ethr (null if unparsable). */
  issuerAddress: `0x${string}` | null
  /** Issuer agent's display name from AgentAccountResolver, or null. */
  issuerDisplayName: string | null
  /** Issuer's .agent primary name (ATL_PRIMARY_NAME), or null. */
  issuerPrimaryName: string | null
  /** Target org's smart-account address (the org this credential is FOR —
   *  e.g. Red Feather Circle for an OrgMembership in that circle). May be
   *  null for credentials minted before this column existed. */
  targetOrgAddress: `0x${string}` | null
  /** Target org's display name from AgentAccountResolver. */
  targetOrgDisplayName: string | null
  /** Target org's .agent primary name. */
  targetOrgPrimaryName: string | null
}

export interface AuditRow {
  id: string
  walletContext: string
  verifierId: string
  purpose: string
  revealedAttrs: string
  predicates: string
  pairwiseHandle: string | null
  holderBindingIncluded: number
  result: string
  createdAt: string
}

export interface WalletSummary {
  id: string
  walletContext: string
  holderWalletRef: string
  status: string
  createdAt: string
}

export async function walletStatusAction(opts: { walletContext?: string } = {}): Promise<{
  principal: string
  activeContext: string
  wallets: WalletSummary[]
  credentials: CredentialRow[]
  audit: AuditRow[]
  error?: string
}> {
  try {
    const { principal } = await loadSignerForCurrentUser()

    const [list, audit, wallets] = await Promise.all([
      person.callTool<{ credentials: CredentialRow[] }>(
        'ssi_list_my_credentials',
        opts.walletContext ? { principal, walletContext: opts.walletContext } : { principal },
      ),
      person.callTool<{ audit: AuditRow[] }>('ssi_list_proof_audit', { principal, limit: 50 }),
      person.callTool<{ wallets: WalletSummary[] }>('ssi_list_wallets', { principal }),
    ])

    // "anchored" = schema + credDef both published on chain under the ids
    //              the credential is minted against. The verifier would
    //              resolve the exact same records at proof time.
    const credentials: CredentialRow[] = []
    let resolver: OnChainResolver | null = null
    if (ssiConfig.credentialRegistryContract !== '0x0000000000000000000000000000000000000000') {
      try {
        resolver = new OnChainResolver({
          rpcUrl: ssiConfig.rpcUrl,
          chainId: ssiConfig.chainId,
          contractAddress: ssiConfig.credentialRegistryContract,
        })
      } catch { /* resolver unavailable — leave anchored null */ }
    }

    // Cache issuer-address → { displayName, primaryName }. Many held creds
    // share the same issuer org, so we only hit the resolver once per org.
    const issuerCache = new Map<string, { displayName: string | null; primaryName: string | null }>()
    const issuerLookup = await buildIssuerLookup(list.credentials, issuerCache)

    // Same idea for target-org addresses (the org the credential is FOR).
    // These are agent smart-account addresses, so direct getCore lookups
    // resolve them (no controller-list scan needed).
    const targetCache = new Map<string, { displayName: string | null; primaryName: string | null }>()
    const targetLookup = await buildAgentLookup(
      list.credentials.map(c => (c as { targetOrgAddress?: string | null }).targetOrgAddress ?? null),
      targetCache,
    )

    for (const c of list.credentials) {
      let anchored: boolean | null = null
      if (resolver) {
        try {
          const [okS, okC] = await Promise.all([
            resolver.isSchemaPublished(c.schemaId),
            resolver.isCredDefPublished(c.credDefId),
          ])
          anchored = okS && okC
        } catch { anchored = false }
      }
      const addr = addrFromDidEthr(c.issuerId)
      const meta = addr ? issuerLookup.get(addr.toLowerCase()) ?? null : null
      const target = (c as { targetOrgAddress?: string | null }).targetOrgAddress ?? null
      const targetMeta = target ? targetLookup.get(target.toLowerCase()) ?? null : null
      credentials.push({
        ...c,
        anchored,
        issuerAddress: addr,
        issuerDisplayName: meta?.displayName ?? null,
        issuerPrimaryName: meta?.primaryName ?? null,
        targetOrgAddress: target ? (target.toLowerCase() as `0x${string}`) : null,
        targetOrgDisplayName: targetMeta?.displayName ?? null,
        targetOrgPrimaryName: targetMeta?.primaryName ?? null,
      })
    }

    const activeContext = opts.walletContext
      ?? wallets.wallets[0]?.walletContext
      ?? 'default'

    return {
      principal,
      activeContext,
      wallets: wallets.wallets,
      credentials,
      audit: audit.audit,
    }
  } catch (err) {
    return {
      principal: '',
      activeContext: 'default',
      wallets: [],
      credentials: [],
      audit: [],
      error: (err as Error).message,
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────

/** Parse `did:ethr:<chainId>:<addr>` → 0x-address (lowercase). */
function addrFromDidEthr(issuerId: string): `0x${string}` | null {
  const m = /^did:ethr:\d+:(0x[0-9a-fA-F]{40})$/.exec(issuerId)
  return m ? (m[1].toLowerCase() as `0x${string}`) : null
}

/**
 * Direct agent-address → { displayName, primaryName } lookup. Unlike the
 * issuer lookup, the addresses here are the agent's smart-account address
 * directly (not a controller EOA), so a single getCore + getStringProperty
 * pair per address is sufficient.
 */
async function buildAgentLookup(
  addrs: Array<string | null>,
  cache: Map<string, { displayName: string | null; primaryName: string | null }>,
): Promise<Map<string, { displayName: string | null; primaryName: string | null }>> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return cache
  const client = getPublicClient()
  const wanted = new Set<string>()
  for (const a of addrs) if (a) wanted.add(a.toLowerCase())

  await Promise.all(Array.from(wanted).map(async addr => {
    if (cache.has(addr)) return
    let displayName: string | null = null
    let primaryName: string | null = null
    try {
      const core = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getCore', args: [addr as `0x${string}`],
      }) as { displayName: string }
      displayName = core.displayName || null
    } catch { /* */ }
    try {
      const n = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [addr as `0x${string}`, ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
      primaryName = n || null
    } catch { /* */ }
    cache.set(addr, { displayName, primaryName })
  }))
  return cache
}

/**
 * For every distinct issuer-EOA in the credential list, find the on-chain
 * org agent that lists this EOA as one of its ATL_CONTROLLER entries, and
 * return that org's displayName + primary .agent name.
 *
 * The issuer DID's address is the org-mcp signing EOA (the org's hot
 * wallet) — NOT the org agent's smart-account address. So a direct
 * `getCore(issuerEoa)` always returns empty. We have to scan org agents
 * and check controller lists.
 *
 * To avoid an O(creds × orgs) RPC blast, we build a single EOA→orgMeta
 * index by walking the active ORGANIZATION agents once per request.
 */
async function buildIssuerLookup(
  rows: Array<{ issuerId: string }>,
  cache: Map<string, { displayName: string | null; primaryName: string | null }>,
): Promise<Map<string, { displayName: string | null; primaryName: string | null }>> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return cache

  const wantedEoas = new Set<string>()
  for (const r of rows) {
    const a = addrFromDidEthr(r.issuerId)
    if (a) wantedEoas.add(a.toLowerCase())
  }
  if (wantedEoas.size === 0) return cache

  const client = getPublicClient()

  // Walk active organization agents and harvest their controller lists.
  let count = 0n
  try {
    count = (await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount',
    })) as bigint
  } catch { return cache }

  const idxs = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
  const agentAddrs = await Promise.all(idxs.map(i =>
    client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getAgentAt', args: [i],
    }) as Promise<`0x${string}`>,
  ))
  const cores = await Promise.all(agentAddrs.map(a =>
    client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getCore', args: [a],
    }) as Promise<{ agentType: `0x${string}`; displayName: string; active: boolean }>,
  ))
  const orgIdxs = cores
    .map((c, i) => (c.agentType === TYPE_ORGANIZATION && c.active) ? i : -1)
    .filter(i => i >= 0)

  await Promise.all(orgIdxs.map(async i => {
    const orgAddr = agentAddrs[i]
    let controllers: `0x${string}`[] = []
    try {
      controllers = (await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [orgAddr, ATL_CONTROLLER as `0x${string}`],
      })) as `0x${string}`[]
    } catch { return }

    // Match the org's smart-account address itself (in case the issuer DID
    // is ever set to it directly) plus every registered controller EOA.
    const matched: string[] = []
    if (wantedEoas.has(orgAddr.toLowerCase())) matched.push(orgAddr.toLowerCase())
    for (const ctl of controllers) {
      if (wantedEoas.has(ctl.toLowerCase())) matched.push(ctl.toLowerCase())
    }
    if (matched.length === 0) return

    let primaryName: string | null = null
    try {
      const n = (await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [orgAddr, ATL_PRIMARY_NAME as `0x${string}`],
      })) as string
      primaryName = n || null
    } catch { /* */ }

    const meta = { displayName: cores[i].displayName || null, primaryName }
    for (const eoa of matched) cache.set(eoa, meta)
  }))

  // Mark unresolved EOAs with explicit null so the caller doesn't keep retrying.
  for (const eoa of wantedEoas) {
    if (!cache.has(eoa)) cache.set(eoa, { displayName: null, primaryName: null })
  }
  return cache
}
