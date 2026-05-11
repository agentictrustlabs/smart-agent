/**
 * Spec 001 — Intent Marketplace (Direct Lane). MatchInitiation MCP tools.
 *
 * org-mcp side: org initiators (an org member proposing a match between
 * two org-tenanted intents, or one org intent + one external). The
 * person-mcp twin is at `apps/person-mcp/src/tools/matchInitiations.ts`.
 *
 * Tools registered (each tool name === scope name):
 *   - match_initiation:create     — write row, cascade ack-count, dispatch
 *                                   connector notifications, conditionally
 *                                   anchor on chain (deferred to action layer).
 *   - match_initiation:read       — list the caller's own initiations.
 *   - match_initiation:supersede  — STUB.
 *   - match_initiation:consume    — STUB.
 *
 * Persistence: `match_initiations` table (org-mcp twin per IA § 2.1).
 *
 * Cross-MCP federation: v1 same-DB shortcut. // TODO(cross-mcp).
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { keccak256, encodePacked, getAddress, isAddress, type Address } from 'viem'
import { db } from '../db/index.js'
import {
  orgIntents,
  orgNotifications,
} from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { MatchInitiationRegistryClient } from '@smart-agent/sdk'
import { callA2aRedeem } from '../lib/a2a-client.js'
import { requireMatchInitiationRegistryAddress } from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

interface RankBasis {
  proximityHops: number
  proximityScore: number
  priorOutcomes: { fulfilled: number; abandoned: number }
  outcomeScore: number
  composite: number
  isColdStart: boolean
}

type MatchInitiationVisibility = 'public' | 'public-coarse' | 'private' | 'off-chain'
type MatchInitiationKind = 'self' | 'connector'

interface CreateArgs {
  token: string
  viewedIntentId: string
  candidateIntentId: string
  basis: RankBasis
  visibility?: MatchInitiationVisibility
  /** Publisher AgentAccount address — REQUIRED. For org-initiated MIs,
   *  this is the org admin's AgentAccount (the same account that the
   *  user signs delegations from). The on-chain `create` call enforces
   *  `_isAccountOwner(publisher, msg.sender)`; self-ownership of the
   *  AgentAccount lets the dispatched call (`account.execute(target, ...)`)
   *  pass when publisher == msg.sender. */
  publisher?: string
  _a2aSessionId?: string
}

type CreateErrorKind =
  | { kind: 'stale-candidate'; reason: 'withdrawn' | 'fulfilled' | 'abandoned' }
  | { kind: 'duplicate-pending'; existingInitiationId: string }
  | { kind: 'self-match-excluded' }
  | { kind: 'visibility-blocked'; reason: 'private-non-credentialed' }
  | { kind: 'validation'; messages: string[] }

function err(error: CreateErrorKind) {
  return mcpText({ ok: false as const, error })
}

interface OrgIntentRow {
  id: string
  orgPrincipal: string
  direction: string
  kind: string
  status: string
  visibility: string
  liveAcknowledgementCount: number | null
}

function findIntentRow(intentId: string): OrgIntentRow | null {
  const rows = db.select().from(orgIntents).where(eq(orgIntents.id, intentId)).all()
  return rows[0] ?? null
}

function bumpAckCountLocal(intentId: string, delta: 1 | -1): { bumped: boolean } {
  const row = db.select().from(orgIntents).where(eq(orgIntents.id, intentId)).all()[0]
  if (!row) {
    console.warn(
      `[org-mcp/matchInitiations] ack-count bump skipped — intent ${intentId} not local. // TODO(cross-mcp)`,
    )
    return { bumped: false }
  }
  const cur = row.liveAcknowledgementCount ?? 0
  const next = Math.max(0, cur + delta)
  let nextStatus = row.status
  if (cur === 0 && next === 1 && nextStatus === 'expressed') nextStatus = 'acknowledged'
  else if (cur === 1 && next === 0 && nextStatus === 'acknowledged') nextStatus = 'expressed'
  db.update(orgIntents)
    .set({ liveAcknowledgementCount: next, status: nextStatus, updatedAt: nowIso() })
    .where(eq(orgIntents.id, intentId))
    .run()
  return { bumped: true }
}

function dispatchConnectorNotification(opts: {
  toOrgPrincipal: string
  initiatorAgentId: string
  viewedIntentId: string
  candidateIntentId: string
  initiationId: string
}): void {
  // Org notifications are inserted whenever the target principal is local
  // to this org-mcp instance (same-DB shortcut). // TODO(cross-mcp).
  db.insert(orgNotifications).values({
    id: randomUUID(),
    orgPrincipal: opts.toOrgPrincipal,
    kind: 'match-initiation-connector',
    payload: JSON.stringify({
      initiationId: opts.initiationId,
      initiatorAgentId: opts.initiatorAgentId,
      viewedIntentId: opts.viewedIntentId,
      candidateIntentId: opts.candidateIntentId,
    }),
    readAt: null,
    createdAt: nowIso(),
  }).run()
}

function strictestVisibility(a: string, b: string): MatchInitiationVisibility {
  const order: MatchInitiationVisibility[] = ['private', 'off-chain', 'public-coarse', 'public']
  const ax = order.indexOf(a as MatchInitiationVisibility)
  const bx = order.indexOf(b as MatchInitiationVisibility)
  const ai = ax === -1 ? 0 : ax
  const bi = bx === -1 ? 0 : bx
  return order[Math.min(ai, bi)]
}

/** Derive the initiator's pseudonym nullifier from their authenticated
 *  principal. Spec 004 MIs are NOT AnonCreds-gated (cred-gated flows are
 *  voting + grant proposals); initiator anonymity is handled via the
 *  visibility cascade. The nullifier is used solely as the on-chain
 *  subject key so the same initiator can re-derive the subject for
 *  status mutations (supersede/consume) without re-publishing identity. */
function initiatorNullifierForPrincipal(principal: string): `0x${string}` {
  return keccak256(encodePacked(['string', 'string'], ['sa:miInitiator:', principal.toLowerCase()]))
}

const createTool = {
  name: 'match_initiation:create',
  description:
    "Write a MatchInitiation to the on-chain MatchInitiationRegistry pairing two intents (org-initiator side per IA § 2.1). Cascades intent:bump_ack_count +1 to both intent owners and dispatches connector-mode notifications.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      viewedIntentId: { type: 'string' },
      candidateIntentId: { type: 'string' },
      basis: { type: 'object' },
      visibility: { type: 'string' },
      publisher: { type: 'string' },
    },
    required: ['token', 'viewedIntentId', 'candidateIntentId', 'basis'],
  },
  handler: async (args: CreateArgs) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'match_initiation:create')

    if (args.viewedIntentId === args.candidateIntentId) {
      return err({ kind: 'validation', messages: ['viewedIntentId and candidateIntentId must differ'] })
    }

    const viewed = findIntentRow(args.viewedIntentId)
    const candidate = findIntentRow(args.candidateIntentId)
    if (!viewed || !candidate) {
      console.warn(
        `[org-mcp/matchInitiations] intent lookup failed (viewed=${!!viewed} candidate=${!!candidate}); cross-MCP federation not implemented. // TODO(cross-mcp)`,
      )
    }

    for (const i of [viewed, candidate]) {
      if (!i) continue
      if (i.status === 'withdrawn' || i.status === 'fulfilled' || i.status === 'abandoned') {
        return err({
          kind: 'stale-candidate',
          reason: i.status as 'withdrawn' | 'fulfilled' | 'abandoned',
        })
      }
    }

    if (viewed && candidate && viewed.orgPrincipal === candidate.orgPrincipal) {
      return err({ kind: 'self-match-excluded' })
    }
    if (viewed && candidate && viewed.direction === candidate.direction) {
      return err({
        kind: 'validation',
        messages: ['viewedIntent.direction must differ from candidateIntent.direction'],
      })
    }
    if (viewed && candidate && viewed.kind !== candidate.kind) {
      return err({
        kind: 'validation',
        messages: ['viewedIntent.kind must equal candidateIntent.kind (object equality)'],
      })
    }

    let visibility: MatchInitiationVisibility = args.visibility ?? 'private'
    if (!args.visibility && viewed && candidate) {
      visibility = strictestVisibility(viewed.visibility, candidate.visibility)
    }

    let initiationKind: MatchInitiationKind = 'connector'
    if (viewed && candidate) {
      if (orgPrincipal === viewed.orgPrincipal || orgPrincipal === candidate.orgPrincipal) {
        initiationKind = 'self'
      }
    }

    const sessionId = args._a2aSessionId
    if (!sessionId) {
      return mcpText({ ok: false as const, error: { kind: 'auth', message: '_a2aSessionId missing — match_initiation:create requires the a2a-agent session id' } })
    }
    const publisherRaw = args.publisher ?? orgPrincipal
    if (!isAddress(publisherRaw)) {
      return err({ kind: 'validation', messages: ['publisher must be an EVM address'] })
    }
    const publisher: Address = getAddress(publisherRaw)

    const initiatorNullifier = initiatorNullifierForPrincipal(orgPrincipal)
    const miSubject = keccak256(encodePacked(
      ['string', 'string', 'string', 'string', 'bytes32'],
      ['sa:matchInitiation:', args.viewedIntentId, ':', args.candidateIntentId, initiatorNullifier],
    ))
    const visibilityForChain: 'public' | 'public-coarse' | 'private' =
      visibility === 'off-chain' ? 'private' : visibility

    const callData = MatchInitiationRegistryClient.encodeCreate({
      viewedIntentId: args.viewedIntentId,
      candidateIntentId: args.candidateIntentId,
      initiatorNullifier,
      initiationKind,
      visibility: visibilityForChain,
      basisJson: JSON.stringify(args.basis),
      publisher,
    })
    const tx = await callA2aRedeem(sessionId, {
      mcpTool: 'match_initiation:create',
      mcpCallId: randomUUID(),
      target: requireMatchInitiationRegistryAddress(),
      value: 0n,
      callData,
    })

    if (viewed) bumpAckCountLocal(args.viewedIntentId, 1)
    if (candidate) bumpAckCountLocal(args.candidateIntentId, 1)

    if (initiationKind === 'connector' && viewed && candidate) {
      try {
        dispatchConnectorNotification({
          toOrgPrincipal: viewed.orgPrincipal,
          initiatorAgentId: orgPrincipal,
          viewedIntentId: args.viewedIntentId,
          candidateIntentId: args.candidateIntentId,
          initiationId: miSubject,
        })
      } catch (e) {
        console.warn(`[org-mcp/matchInitiations] viewed-side notif dispatch failed: ${(e as Error).message}`)
      }
      try {
        dispatchConnectorNotification({
          toOrgPrincipal: candidate.orgPrincipal,
          initiatorAgentId: orgPrincipal,
          viewedIntentId: args.viewedIntentId,
          candidateIntentId: args.candidateIntentId,
          initiationId: miSubject,
        })
      } catch (e) {
        console.warn(`[org-mcp/matchInitiations] candidate-side notif dispatch failed: ${(e as Error).message}`)
      }
    }

    return mcpText({
      ok: true as const,
      initiation: {
        id: miSubject,
        miSubject,
        txHash: tx.txHash,
        viewedIntentId: args.viewedIntentId,
        candidateIntentId: args.candidateIntentId,
        initiatorAgentId: orgPrincipal,
        initiationKind,
        proposedAt: nowIso(),
        basis: args.basis,
        status: 'pending' as const,
        visibility,
      },
    })
  },
}

const readTool = {
  name: 'match_initiation:read',
  description: "STUB — SQL match_initiations table is dropped; reads now flow from GraphDB (mirror of MatchInitiationRegistry). Returns an empty list until the on-chain→GraphDB sync is wired (spec 004 cleanup queue).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      intentId: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['token'],
  },
  handler: async (args: { token: string; intentId?: string; status?: string }) => {
    await requireOrgPrincipal(args.token, args, 'match_initiation:read')
    void args
    console.warn(
      '[org-mcp/matchInitiations] read invoked but SQL table dropped — returning empty list until GraphDB sync ships.',
    )
    return mcpText({ initiations: [] as Array<unknown> })
  },
}

const STATUS_SUPERSEDED = keccak256(encodePacked(['string'], ['sa:MatchInitiationSuperseded'] as const))
const STATUS_CONSUMED = keccak256(encodePacked(['string'], ['sa:MatchInitiationConsumed'] as const))

async function setMatchStatus(args: {
  token: string
  miSubject: `0x${string}`
  newStatus: `0x${string}`
  publisher?: string
  _a2aSessionId?: string
  toolName: string
}): Promise<ReturnType<typeof mcpText>> {
  const orgPrincipal = await requireOrgPrincipal(args.token, args, args.toolName)
  if (!args.miSubject || !args.miSubject.startsWith('0x')) {
    throw new Error('miSubject must be a bytes32 hex')
  }
  const sessionId = args._a2aSessionId
  if (!sessionId) {
    throw new Error(`_a2aSessionId missing — ${args.toolName} requires the a2a-agent session id`)
  }
  const publisherRaw = args.publisher ?? orgPrincipal
  if (!isAddress(publisherRaw)) {
    throw new Error('publisher must be an EVM address')
  }
  const publisher: Address = getAddress(publisherRaw)
  const callData = MatchInitiationRegistryClient.encodeSetStatus({
    miSubject: args.miSubject,
    newStatus: args.newStatus,
    publisher,
  })
  const tx = await callA2aRedeem(sessionId, {
    mcpTool: args.toolName,
    mcpCallId: randomUUID(),
    target: requireMatchInitiationRegistryAddress(),
    value: 0n,
    callData,
  })
  return mcpText({ ok: true as const, txHash: tx.txHash, miSubject: args.miSubject })
}

const supersedeTool = {
  name: 'match_initiation:supersede',
  description: "Set the on-chain status of a MatchInitiation to 'superseded'. The miSubject is the bytes32 returned by `match_initiation:create`.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      miSubject: { type: 'string' },
      publisher: { type: 'string' },
    },
    required: ['token', 'miSubject'],
  },
  handler: async (args: { token: string; miSubject: `0x${string}`; publisher?: string; _a2aSessionId?: string }) =>
    setMatchStatus({ ...args, newStatus: STATUS_SUPERSEDED, toolName: 'match_initiation:supersede' }),
}

const consumeTool = {
  name: 'match_initiation:consume',
  description: "Set the on-chain status of a MatchInitiation to 'consumed'. The miSubject is the bytes32 returned by `match_initiation:create`.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      miSubject: { type: 'string' },
      publisher: { type: 'string' },
    },
    required: ['token', 'miSubject'],
  },
  handler: async (args: { token: string; miSubject: `0x${string}`; publisher?: string; _a2aSessionId?: string }) =>
    setMatchStatus({ ...args, newStatus: STATUS_CONSUMED, toolName: 'match_initiation:consume' }),
}

export const matchInitiationsTools = {
  'match_initiation:create': createTool,
  'match_initiation:read': readTool,
  'match_initiation:supersede': supersedeTool,
  'match_initiation:consume': consumeTool,
}
