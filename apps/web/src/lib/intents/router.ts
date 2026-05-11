/**
 * Spec-001/004 intent federation helper.
 *
 * Routes intent reads + writes through the owner's MCP (person-mcp for
 * person agents, org-mcp for org agents). Replaces direct
 * `db.select().from(schema.intents)` reads in the web app so the SQL
 * `intents` table can be retired (privacy gap: the web's shared SQLite
 * doesn't partition by user / org).
 *
 * Field mapping (web ↔ MCP):
 *
 *   web.id                ↔ mcp.id
 *   web.direction         ↔ mcp.direction
 *   web.object            ↔ mcp.kind          // both = matcher discriminator
 *   web.intentType        → context.intentType (JSON)
 *   web.intentTypeLabel   → context.intentTypeLabel (JSON)
 *   web.topic             → context.topic (JSON)
 *   web.hubId             → context.hubId (JSON)
 *   web.title             ↔ mcp.summary
 *   web.detail            ↔ mcp.context        // when no UI payload
 *   web.payload           → context.payload (JSON)
 *   web.expectedOutcome   → context.expectedOutcome (JSON)
 *   web.expressedByAgent  ↔ mcp.principal
 *   web.expressedByUserId → derived from principal via web users table
 *   web.addressedTo       ↔ mcp.addressedTo
 *   web.priority          ↔ mcp.priority
 *   web.visibility        ↔ mcp.visibility
 *   web.status            ↔ mcp.status
 *   web.validUntil        ↔ mcp.expiresAt
 *   web.createdAt         ↔ mcp.createdAt
 *   web.updatedAt         ↔ mcp.updatedAt
 *
 * The "context.*" UI overlay is packed into MCP's `context` field (a
 * JSON string column the MCP doesn't interpret). The MCP-side matcher
 * uses `direction` + `kind`; the rich UI fields stay invisible to the
 * matcher and to other MCPs.
 */

import 'server-only'
import { callMcp } from '@/lib/clients/mcp-client'

// ─── Web-shaped intent row (mirrors apps/web/src/lib/actions/intents.action IntentRow) ──

export type IntentDirection = 'receive' | 'give'
export type IntentStatus =
  | 'drafted' | 'expressed' | 'acknowledged' | 'in-progress'
  | 'fulfilled' | 'withdrawn' | 'abandoned'
export type IntentVisibility = 'public' | 'public-coarse' | 'private' | 'off-chain'

export interface IntentRowFromMcp {
  id: string
  direction: IntentDirection
  object: string
  topic: string | null
  intentType: string
  intentTypeLabel: string
  expressedByAgent: string
  expressedByUserId: string | null
  addressedTo: string
  hubId: string
  title: string
  detail: string | null
  payload: Record<string, unknown> | null
  status: IntentStatus
  priority: 'critical' | 'high' | 'normal' | 'low'
  visibility: IntentVisibility
  expectedOutcome: { description: string; metric: unknown } | null
  projectionRef: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

// ─── MCP raw shape ────────────────────────────────────────────────────

interface McpIntentRaw {
  id: string
  principal: string
  direction: IntentDirection
  visibility: IntentVisibility
  kind: string
  addressedTo: string | null
  summary: string
  context: string | null              // JSON: { intentType, intentTypeLabel, topic, hubId, payload, expectedOutcome, detail }
  status: IntentStatus
  priority: string | null
  expiresAt: string | null
  onChainAssertionId: string | null
  liveAcknowledgementCount?: number
  createdAt: string
  updatedAt: string
}

interface UiOverlay {
  intentType?: string
  intentTypeLabel?: string
  topic?: string | null
  hubId?: string
  payload?: Record<string, unknown> | null
  expectedOutcome?: { description: string; metric: unknown } | null
  detail?: string | null
}

function parseOverlay(raw: string | null): UiOverlay {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as UiOverlay | Record<string, unknown>
    if (typeof parsed === 'object' && parsed !== null) return parsed as UiOverlay
    return {}
  } catch { return {} }
}

export function mcpIntentToWebRow(raw: McpIntentRaw): IntentRowFromMcp {
  const overlay = parseOverlay(raw.context)
  return {
    id: raw.id,
    direction: raw.direction,
    object: raw.kind,
    topic: overlay.topic ?? null,
    intentType: overlay.intentType ?? 'intentType:Other',
    intentTypeLabel: overlay.intentTypeLabel ?? raw.summary,
    expressedByAgent: raw.principal,
    expressedByUserId: null,                        // not stored on MCP side
    addressedTo: raw.addressedTo ?? 'self',
    hubId: overlay.hubId ?? '',
    title: raw.summary,
    detail: overlay.detail ?? null,
    payload: overlay.payload ?? null,
    status: raw.status,
    priority: (raw.priority as IntentRowFromMcp['priority']) ?? 'normal',
    visibility: raw.visibility,
    expectedOutcome: overlay.expectedOutcome ?? null,
    projectionRef: null,
    validUntil: raw.expiresAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

// ─── Public surface ───────────────────────────────────────────────────

export interface ListIntentsViaMcpOptions {
  direction?: IntentDirection
  status?: IntentStatus
  /** Source: 'person' uses person-mcp (default for solo human flows),
   *  'org' uses org-mcp. The action layer picks based on the viewer's
   *  primary agent kind. */
  source?: 'person' | 'org'
}

/** Fetch the authenticated viewer's intents via their owner MCP. Returns
 *  an empty array on failure (MCP unreachable / no creds / etc.); the
 *  caller treats absence as "no intents" rather than crashing. */
export async function listIntentsViaMcp(
  opts: ListIntentsViaMcpOptions = {},
): Promise<IntentRowFromMcp[]> {
  const source = opts.source ?? 'person'
  const toolName = source === 'org' ? 'list_org_intents' : 'list_intents'
  const args: Record<string, unknown> = {}
  if (opts.direction) args.direction = opts.direction
  if (opts.status) args.status = opts.status
  try {
    const res = await callMcp<{ intents?: McpIntentRaw[] }>(source, toolName, args)
    return (res.intents ?? []).map(mcpIntentToWebRow)
  } catch {
    return []
  }
}

export async function getIntentViaMcp(
  id: string,
  source: 'person' | 'org' = 'person',
): Promise<IntentRowFromMcp | null> {
  const toolName = source === 'org' ? 'get_org_intent' : 'get_intent'
  try {
    const res = await callMcp<{ intent?: McpIntentRaw | null }>(source, toolName, { id })
    if (!res.intent) return null
    return mcpIntentToWebRow(res.intent)
  } catch {
    return null
  }
}

// ─── Write paths ──────────────────────────────────────────────────────

export interface ExpressIntentViaMcpInput {
  direction: IntentDirection
  object: string                 // becomes MCP `kind`
  title: string                  // becomes MCP `summary`
  detail?: string | null
  intentType: string
  intentTypeLabel: string
  topic?: string | null
  hubId: string
  payload?: Record<string, unknown> | null
  expectedOutcome?: { description: string; metric: unknown } | null
  priority?: 'critical' | 'high' | 'normal' | 'low'
  visibility?: IntentVisibility
  addressedTo?: string
  validUntil?: string | null
  /** Which MCP to route to. 'person' for solo human, 'org' for org-as-expresser. */
  source?: 'person' | 'org'
}

/** Pack UI-only fields into MCP's context JSON. */
function packOverlay(input: ExpressIntentViaMcpInput): string {
  const overlay: UiOverlay = {
    intentType: input.intentType,
    intentTypeLabel: input.intentTypeLabel,
    topic: input.topic ?? null,
    hubId: input.hubId,
    payload: input.payload ?? null,
    expectedOutcome: input.expectedOutcome ?? null,
    detail: input.detail ?? null,
  }
  return JSON.stringify(overlay)
}

export async function expressIntentViaMcp(
  input: ExpressIntentViaMcpInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const source = input.source ?? 'person'
  const toolName = source === 'org' ? 'express_org_intent' : 'express_intent'
  try {
    const res = await callMcp<{ intent?: { id: string }; error?: string }>(source, toolName, {
      direction: input.direction,
      kind: input.object,
      summary: input.title,
      context: packOverlay(input),
      addressedTo: input.addressedTo ?? null,
      priority: input.priority ?? 'normal',
      visibility: input.visibility ?? 'private',
      expiresAt: input.validUntil ?? null,
      // Pass capacity / geo / timeWindow through too — the MCP tool
      // also writes a `needs` or `offerings` projection from these.
      capacity: typeof input.payload?.capacity === 'object' &&
        input.payload?.capacity !== null &&
        'amount' in (input.payload.capacity as object)
          ? (input.payload.capacity as { amount: number }).amount
          : undefined,
      geo: typeof input.payload?.geo === 'string' ? input.payload.geo : undefined,
    })
    if (res.error) return { ok: false, error: res.error }
    const id = res.intent?.id
    if (!id) return { ok: false, error: 'MCP returned no intent id' }
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function withdrawIntentViaMcp(
  id: string,
  source: 'person' | 'org' = 'person',
): Promise<{ ok: boolean }> {
  const toolName = source === 'org' ? 'withdraw_org_intent' : 'withdraw_intent'
  try {
    const res = await callMcp<{ updated?: boolean }>(source, toolName, { id })
    return { ok: !!res.updated }
  } catch {
    return { ok: false }
  }
}
