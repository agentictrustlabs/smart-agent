'use server'

/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolPledge action layer.
 *
 * Server-only entry points used by the pledge composer + management routes.
 * Mirrors the style of `grantProposals.action.ts`.
 *
 * Submit pipeline:
 *   1. Call donor's MCP `pool_pledge:submit` (validates + persists row).
 *   2. On success + (pool public AND non-anonymous): emit
 *      `sa:PledgeAssertion` (full or coarse). Best-effort; the row stays
 *      authoritative regardless.
 *
 * v1 SIMPLIFICATION: cross-MCP federation is deferred. The donor's MCP
 * uses a same-DB shortcut to read the pool body for validation. // TODO(cross-mcp).
 */

import { DiscoveryService } from '@smart-agent/discovery'
import {
  PoolPledgeClient,
  type SubmitPledgeRequest,
  type SubmitPledgeResult,
  type PoolPledge,
  type AmendPledgeRequest,
  type McpInvoker,
  type McpTarget,
} from '@smart-agent/sdk'
import { callMcp } from '@/lib/clients/mcp-client'
import { emitPledgeAssertion } from '@/lib/onchain/poolPledgeAssertion'

// ───────────────────────────────────────────────────────────────────────
// MCP invoker — mirrors grantProposals.action.ts
// ───────────────────────────────────────────────────────────────────────

function makeMcpInvoker(target: McpTarget): McpInvoker {
  return {
    async call<T = unknown>(
      _t: McpTarget,
      tool: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      const server = target === 'self' ? 'org' : target === 'fund' ? 'org' : 'person'
      return callMcp<T>(server as 'org' | 'person', tool, args)
    },
  }
}

// ───────────────────────────────────────────────────────────────────────
// Row parsing
// ───────────────────────────────────────────────────────────────────────

interface RawPledgeRow {
  id: string
  principal: string
  poolAgentId: string
  cadence: string
  unit: string
  amount: number
  duration: number | null
  restrictions: string | object | null
  storyPermissions: string
  pledgedAt: string
  stoppedAt: string | null
  status: string
  history: string | unknown[]
  visibility: string
  onChainAssertionId: string | null
  createdAt: string
  updatedAt: string
  // Spec 005 — pass-through from org-mcp pledge-reader.
  settlements?: Array<{ token: string; honored: string; externallyPaid: string }>
  lastMarkedPayment?: {
    rail: 'crypto' | 'bank' | 'check' | 'cash' | 'in-kind' | 'other'
    evidenceHash: string
    markedByAgent: string
    markedAt: string | null
  } | null
}

function parseJsonField<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T } catch { return fallback }
  }
  return v as T
}

function rowToPledge(row: RawPledgeRow): PoolPledge {
  return {
    id: row.id,
    pledgerAgentId: row.principal,
    poolAgentId: row.poolAgentId,
    cadence: row.cadence as PoolPledge['cadence'],
    unit: row.unit,
    amount: row.amount,
    duration: row.duration ?? undefined,
    restrictions: parseJsonField<PoolPledge['restrictions']>(row.restrictions, undefined),
    storyPermissions: row.storyPermissions as PoolPledge['storyPermissions'],
    pledgedAt: row.pledgedAt,
    stoppedAt: row.stoppedAt ?? undefined,
    status: row.status as PoolPledge['status'],
    history: parseJsonField<PoolPledge['history']>(row.history, []),
    visibility: row.visibility as PoolPledge['visibility'],
    onChainAssertionId: row.onChainAssertionId ?? undefined,
    settlements: row.settlements ?? [],
    lastMarkedPayment: row.lastMarkedPayment ?? null,
  }
}

// ───────────────────────────────────────────────────────────────────────
// Submit pledge
// ───────────────────────────────────────────────────────────────────────

export interface SubmitPledgeActionInput {
  request: SubmitPledgeRequest
  /** Pool's visibility — needed for the on-chain anchor decision. */
  poolVisibility: 'public' | 'private'
  /** Donor's MCP target. v1 routes to 'org' for org donors, 'intent' for solo humans. */
  donorKind?: 'org' | 'person'
  /** Pool's treasury (AgentAccount) address. Spec 004 — pool_pledge:submit
   *  now requires this so the on-chain `PledgeRegistry.submit` can derive
   *  the pledge subject. The action layer resolves it via DiscoveryService
   *  (pool URN → treasury) or accepts it from the caller. */
  poolAgent?: `0x${string}`
}

export async function submitPledge(
  input: SubmitPledgeActionInput,
): Promise<SubmitPledgeResult> {
  const target: McpTarget = input.donorKind === 'person' ? 'intent' : 'self'
  const invoker = makeMcpInvoker(target)
  const client = new PoolPledgeClient(invoker, target)

  // Spec 004 (b2) — pool_pledge:submit requires `poolAgent` (hex) + `chain`.
  // Pledges are NOT cred-gated (no presentation needed); only the chain
  // is required so msg.sender at the registry = pool admin.
  if (!input.poolAgent) {
    return {
      ok: false,
      error: { kind: 'validation' as const, messages: ['poolAgent required for spec-004 redeem'] },
    } as unknown as SubmitPledgeResult
  }
  const { resolveSpec004Chain } = await import('@/lib/spec004/chain')
  const pledgeRegistry = process.env.PLEDGE_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!pledgeRegistry) {
    return {
      ok: false,
      error: { kind: 'validation' as const, messages: ['PLEDGE_REGISTRY_ADDRESS not set'] },
    } as unknown as SubmitPledgeResult
  }
  // The donor's admin→holder delegation for pledging is bound to
  // PledgeRegistry. Pledges don't use AnonCreds creds today; the
  // `findMarketplaceCredentialForRegistry` lookup returns whatever
  // delegation the admin pre-signed for the donor — credentialType is
  // intentionally left open.
  const { SPEC004_SELECTORS } = await import('@smart-agent/sdk')
  let chain = await resolveSpec004Chain({
    targetRegistry: pledgeRegistry,
    methodSelectors: [SPEC004_SELECTORS.pledgeSubmit],
  })

  // Pledges are permissionless on chain (any donor may commit; the donor's
  // identity is captured at submit). The chain auth needs only a single
  // self-issued admin→holder delegation rooted at the DONOR's own smart
  // account, signed by the donor's own key. Demo users sign with
  // users.privateKey; passkey/SIWE sign via loadSignerForCurrentUser (which
  // still falls back to deployer until the passkey ceremony lands — that
  // fallback is scoped to passkey/SIWE only, never demo).
  if (!chain.ok && chain.error === 'no-marketplace-credential') {
    const { getSession } = await import('@/lib/auth/session')
    const session = await getSession()
    if (!session?.smartAccountAddress) {
      return {
        ok: false,
        error: { kind: 'validation' as const, messages: ['not signed in'] },
      } as unknown as SubmitPledgeResult
    }
    const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
    let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
    try { signerCtx = await loadSignerForCurrentUser() } catch { /* not signed in */ }
    if (signerCtx?.kind !== 'eoa' || !signerCtx.userRow.privateKey) {
      return {
        ok: false,
        error: { kind: 'validation' as const, messages: [
          'cannot self-sign pledger delegation — no EOA key available (passkey ceremony not yet wired)',
        ]},
      } as unknown as SubmitPledgeResult
    }
    const { selfIssuePledgerDelegation } = await import('@/lib/spec004/self-issue')
    const issued = await selfIssuePledgerDelegation({
      smartAccount: session.smartAccountAddress as `0x${string}`,
      pledgeRegistry,
      principal: signerCtx.principal,
      signerPrivateKey: signerCtx.userRow.privateKey as `0x${string}`,
    })
    if (issued.ok) {
      chain = await resolveSpec004Chain({
        targetRegistry: pledgeRegistry,
        methodSelectors: [SPEC004_SELECTORS.pledgeSubmit],
      })
    } else {
      return {
        ok: false,
        error: { kind: 'validation' as const, messages: [`self-issue failed: ${issued.error}`] },
      } as unknown as SubmitPledgeResult
    }
  }

  if (!chain.ok) {
    return {
      ok: false,
      error: { kind: 'validation' as const, messages: [`chain: ${chain.error} — ${chain.message}`] },
    } as unknown as SubmitPledgeResult
  }

  // 1. Submit via MCP. We extend the SDK request with `poolAgent` + `chain`
  //    via a structural cast since the SDK contract doesn't yet model them.
  const augmented = {
    ...input.request,
    poolAgent: input.poolAgent,
    chain: chain.chain,
  } as unknown as SubmitPledgeRequest
  const result = await client.submit(augmented)
  if (!result.ok) return result

  // 2. On-chain anchor when visibility allows.
  // emitPledgeAssertion enforces SHACL gates internally — anonymous OR
  // private-pool returns null without emitting.
  try {
    const assertionId = await emitPledgeAssertion({
      id: result.pledge.id,
      pledgerAgentId: result.pledge.pledgerAgentId,
      poolAgentId: result.pledge.poolAgentId,
      cadence: result.pledge.cadence,
      unit: result.pledge.unit,
      amount: result.pledge.amount,
      duration: result.pledge.duration ?? null,
      storyPermissions: result.pledge.storyPermissions,
      poolVisibility: input.poolVisibility,
      pledgedAt: result.pledge.pledgedAt,
    })
    if (assertionId) {
      // Best-effort: write back the assertion id. We don't have a direct
      // MCP tool for this; surface it via the returned pledge so the UI
      // can show the on-chain badge. The stored row may lack it, which is
      // acceptable for v1 — the assertion lives on chain regardless.
      result.pledge.onChainAssertionId = assertionId
    }
  } catch {
    /* best-effort */
  }

  // Pool aggregates (`pledgedTotal`, `availableTotal`) live in org-mcp; the
  // detail/index pages read them through GraphDB. After a pledge we
  // resync ALL pools (small — 5 pools × ~30 triples) via a single
  // SPARQL DELETE+INSERT instead of the multi-MB full-graph PUT that
  // crashed GraphDB under seed load. We resync all pools rather than
  // one because `result.pledge.poolAgentId` may be URN or hex address
  // depending on caller (data hygiene gap), and a bulk pool sync sidesteps
  // the resolution.
  try {
    const { syncAllPoolsToGraphDB } = await import('@/lib/ontology/graphdb-sync')
    const r = await syncAllPoolsToGraphDB()
    if (!r.ok) console.warn('[submitPledge] pool aggregates sync failed:', r.message)
  } catch (err) {
    console.warn('[submitPledge] pool aggregates sync threw:', err instanceof Error ? err.message : err)
  }

  return result
}

// ───────────────────────────────────────────────────────────────────────
// List/read/amend/stop
// ───────────────────────────────────────────────────────────────────────

export interface ListMemberPledgesResult {
  pledges: PoolPledge[]
}

export async function listMemberPledges(): Promise<ListMemberPledgesResult> {
  // Try both MCPs (orgs and solo humans both can pledge). v1 routes to org
  // first; falls back to person on auth failure.
  const orgInvoker = makeMcpInvoker('self')
  const orgClient = new PoolPledgeClient(orgInvoker, 'self')
  let pledges: PoolPledge[] = []
  try {
    const raws = (await orgClient.listForMember('')) as unknown as RawPledgeRow[]
    pledges = raws.map(rowToPledge)
  } catch {
    pledges = []
  }
  if (pledges.length === 0) {
    try {
      const personInvoker = makeMcpInvoker('intent')
      const personClient = new PoolPledgeClient(personInvoker, 'intent')
      const raws = (await personClient.listForMember('')) as unknown as RawPledgeRow[]
      pledges = raws.map(rowToPledge)
    } catch {
      /* leave empty */
    }
  }
  return { pledges }
}

export interface PoolPledgeSummary {
  id: string
  poolAgentId: string
  /** Pledger label honoring story_permissions (`anon:<prefix>…` when anonymized). */
  principalDisplay: string
  amount: number
  unit: string
  cadence: string
  pledgedAt: string
  status: string
}

/**
 * Public-facing pledges list for a pool's detail page. Calls org-mcp's
 * `pool_pledge:list_for_pool` (which applies story_permissions before
 * returning). Returns an empty array on failure so the page can render
 * the empty-state instead of erroring.
 */
export async function listPoolPledges(
  poolAgentId: string,
  limit = 10,
): Promise<PoolPledgeSummary[]> {
  try {
    const result = await callMcp<{ pledges: PoolPledgeSummary[] }>(
      'org',
      'pool_pledge:list_for_pool',
      { poolAgentId, limit },
    )
    return result.pledges ?? []
  } catch (err) {
    console.warn('[listPoolPledges] failed:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getMemberPledge(pledgeId: string): Promise<PoolPledge | null> {
  const orgInvoker = makeMcpInvoker('self')
  const orgClient = new PoolPledgeClient(orgInvoker, 'self')
  try {
    const raw = await orgClient.getById(pledgeId) as unknown as RawPledgeRow | null
    if (raw) return rowToPledge(raw)
  } catch {
    /* fallthrough */
  }
  try {
    const personInvoker = makeMcpInvoker('intent')
    const personClient = new PoolPledgeClient(personInvoker, 'intent')
    const raw = await personClient.getById(pledgeId) as unknown as RawPledgeRow | null
    if (raw) return rowToPledge(raw)
  } catch {
    /* none */
  }
  return null
}

export async function amendMemberPledge(
  req: AmendPledgeRequest,
): Promise<{ ok: true; pledge: PoolPledge } | { ok: false; error: string }> {
  const orgInvoker = makeMcpInvoker('self')
  const orgClient = new PoolPledgeClient(orgInvoker, 'self')
  try {
    const raw = await orgClient.amend(req) as unknown as RawPledgeRow
    return { ok: true, pledge: rowToPledge(raw) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function stopMemberPledge(
  pledgeId: string,
): Promise<{ ok: true; pledge: PoolPledge } | { ok: false; error: string }> {
  const orgInvoker = makeMcpInvoker('self')
  const orgClient = new PoolPledgeClient(orgInvoker, 'self')
  try {
    const raw = await orgClient.stop(pledgeId) as unknown as RawPledgeRow
    return { ok: true, pledge: rowToPledge(raw) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Use DiscoveryService import to avoid `unused` warnings — kept here so future
// signal computations (e.g., for amend-side rerank) can grow without re-importing.
void DiscoveryService
