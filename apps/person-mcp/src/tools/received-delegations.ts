import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { receivedDelegations } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'
import { verifyCrossDelegation } from '../auth/verify-delegation.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

interface SignedDelegation {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
  salt: string
  signature: `0x${string}`
}

export const receivedDelegationsTools = {
  // ─────────────────────────────────────────────────────────────────────
  register_received_delegation: {
    name: 'register_received_delegation',
    description:
      'Persist an off-chain cross-delegation that the caller received from another '
      + 'principal (e.g. a private coaching grant). Verifies the EIP-712 signature via '
      + "ERC-1271 against the delegator's smart account before storing — invalid "
      + 'delegations are rejected. Idempotent on (holder_principal, delegation_hash).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        delegation: {
          type: 'object',
          description: 'Full signed delegation struct',
          properties: {
            delegator: { type: 'string' },
            delegate: { type: 'string' },
            authority: { type: 'string' },
            caveats: {
              type: 'array',
              items: { type: 'object', properties: { enforcer: { type: 'string' }, terms: { type: 'string' } } },
            },
            salt: { type: 'string' },
            signature: { type: 'string' },
          },
        },
        delegationHash: { type: 'string', description: 'EIP-712 hash of the delegation' },
        kind: { type: 'string', description: "e.g. 'coaching', 'data-share'" },
        subjectLabel: { type: 'string', description: 'Optional display name for the delegator' },
        audience: { type: 'string', description: "Defaults to 'urn:mcp:server:person'" },
      },
      required: ['token', 'delegation', 'delegationHash', 'kind'],
    },
    handler: async (args: {
      token: string
      delegation: SignedDelegation
      delegationHash: string
      kind: string
      subjectLabel?: string
      audience?: string
    }) => {
      const callerPrincipal = await requirePrincipal(args.token, 'register_received_delegation')
      const audience = args.audience ?? 'urn:mcp:server:person'

      // Holder binding: the delegation MUST be addressed to this caller.
      if (args.delegation.delegate.toLowerCase() !== callerPrincipal) {
        return mcpText({ error: 'Delegation delegate does not match caller principal' })
      }

      // ERC-1271 verification — delegator's smart account must validate the signature.
      const verifyResult = await verifyCrossDelegation(args.delegation, callerPrincipal, audience)
      if ('error' in verifyResult) {
        return mcpText({ error: `Delegation verification failed: ${verifyResult.error}` })
      }

      const expiresAt = extractExpiresAt(args.delegation.caveats)

      const row = {
        id: randomUUID(),
        holderPrincipal: callerPrincipal,
        delegatorPrincipal: args.delegation.delegator.toLowerCase(),
        audience,
        kind: args.kind,
        subjectLabel: args.subjectLabel ?? null,
        delegationJson: JSON.stringify(args.delegation),
        delegationHash: args.delegationHash.toLowerCase(),
        expiresAt,
        createdAt: new Date().toISOString(),
        revokedAt: null,
      }

      try {
        db.insert(receivedDelegations).values(row).run()
      } catch (err) {
        // Likely UNIQUE (holder, hash) collision — already registered, treat as success.
        if (err instanceof Error && /UNIQUE/i.test(err.message)) {
          return mcpText({ ok: true, alreadyRegistered: true })
        }
        throw err
      }

      return mcpText({ ok: true, id: row.id, delegatorPrincipal: row.delegatorPrincipal })
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  list_received_delegations: {
    name: 'list_received_delegations',
    description:
      'List off-chain cross-delegations registered to the caller. Returns the parsed '
      + 'delegation, delegator, kind, audience, expiry. Filter by kind via the optional arg.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        kind: { type: 'string', description: 'Optional filter (e.g. "coaching")' },
        includeRevoked: { type: 'boolean' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string; kind?: string; includeRevoked?: boolean }) => {
      const callerPrincipal = await requirePrincipal(args.token, 'list_received_delegations')

      let rows = db.select().from(receivedDelegations)
        .where(eq(receivedDelegations.holderPrincipal, callerPrincipal)).all()

      if (args.kind) rows = rows.filter(r => r.kind === args.kind)
      if (!args.includeRevoked) rows = rows.filter(r => !r.revokedAt)

      const out = rows.map(r => ({
        id: r.id,
        delegatorPrincipal: r.delegatorPrincipal,
        audience: r.audience,
        kind: r.kind,
        subjectLabel: r.subjectLabel,
        delegation: tryParse(r.delegationJson),
        delegationHash: r.delegationHash,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      }))
      return mcpText({ delegations: out })
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  revoke_received_delegation: {
    name: 'revoke_received_delegation',
    description:
      'Soft-delete a received delegation from the caller\'s holder store. The on-chain '
      + 'DelegationManager.isRevoked check remains the authoritative source for actual '
      + 'revocation; this tool just cleans up local visibility.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, delegationHash: { type: 'string' } },
      required: ['token', 'delegationHash'],
    },
    handler: async (args: { token: string; delegationHash: string }) => {
      const callerPrincipal = await requirePrincipal(args.token, 'revoke_received_delegation')
      const r = db.update(receivedDelegations)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(
          eq(receivedDelegations.holderPrincipal, callerPrincipal),
          eq(receivedDelegations.delegationHash, args.delegationHash.toLowerCase()),
        ))
        .run()
      return mcpText({ ok: r.changes > 0 })
    },
  },
}

function tryParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

function extractExpiresAt(
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>,
): string | null {
  // Best-effort: read the timestamp caveat without requiring SDK import here.
  // Terms layout for timestamp enforcer: abi.encode(uint256 validAfter, uint256 validUntil).
  // 32-byte validAfter || 32-byte validUntil → 64 hex chars after 0x.
  for (const c of caveats) {
    const t = c.terms.replace(/^0x/, '')
    if (t.length !== 128) continue
    const validUntil = BigInt('0x' + t.slice(64))
    if (validUntil > 1577836800n && validUntil < 4102444800n) {
      return new Date(Number(validUntil) * 1000).toISOString()
    }
  }
  return null
}
