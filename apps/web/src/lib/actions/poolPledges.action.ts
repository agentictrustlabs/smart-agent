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
}

export async function submitPledge(
  input: SubmitPledgeActionInput,
): Promise<SubmitPledgeResult> {
  const target: McpTarget = input.donorKind === 'person' ? 'intent' : 'self'
  const invoker = makeMcpInvoker(target)
  const client = new PoolPledgeClient(invoker, target)

  // 1. Submit via MCP.
  const result = await client.submit(input.request)
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
