'use server'

/**
 * Policy — Governance shape primary surface.
 *
 * Multi-party sign-off on policy / charter / credential issuance. Operations:
 *   • ensurePolicy           — auto-seed a default policy if none exists
 *   • setPolicy              — provider sets/updates the policy doc + summary
 *   • addSigner              — add a required signer to the roster
 *   • signPolicy             — listed signer adds their signature
 *   • approvePolicy          — when required signatures hit threshold, mark approved
 *
 * Spec: docs/specs/engagement-shapes-plan.md §6 R13
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { and, asc, eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'

export type PolicyState = 'draft' | 'pending' | 'approved' | 'rejected'

export interface PolicyRow {
  id: string
  engagementId: string
  policyDocUri: string | null
  policySummary: string | null
  currentState: PolicyState
  requiredSigners: number
  createdAt: string
  updatedAt: string
}

export interface SignerRow {
  id: string
  policyId: string
  agent: string
  role: string
  signedAt: string | null
  createdAt: string
}

export interface PolicyView extends PolicyRow {
  signers: SignerRow[]
  signedCount: number
}

function rowToPolicy(r: typeof schema.engagementPolicies.$inferSelect): PolicyRow {
  return {
    id: r.id,
    engagementId: r.engagementId,
    policyDocUri: r.policyDocUri,
    policySummary: r.policySummary,
    currentState: r.currentState,
    requiredSigners: r.requiredSigners,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function rowToSigner(r: typeof schema.policySigners.$inferSelect): SignerRow {
  return {
    id: r.id,
    policyId: r.policyId,
    agent: r.agent,
    role: r.role,
    signedAt: r.signedAt,
    createdAt: r.createdAt,
  }
}

async function authorizeRole(engagementId: string): Promise<
  { ok: true; agent: string; engagement: typeof schema.entitlements.$inferSelect; role: 'holder' | 'provider' }
  | { error: string }
> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, engagementId)).get()
  if (!ent) return { error: 'engagement-not-found' }
  const role: 'holder' | 'provider' | null =
    ent.holderAgent === lower ? 'holder'
    : ent.providerAgent === lower ? 'provider'
    : null
  if (!role) return { error: 'not-a-party' }
  return { ok: true, agent: lower, engagement: ent, role }
}

// ─── Auto-seed ─────────────────────────────────────────────────────

export async function ensurePolicy(engagementId: string): Promise<void> {
  const existing = db.select().from(schema.engagementPolicies)
    .where(eq(schema.engagementPolicies.engagementId, engagementId)).get()
  if (existing) return
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, engagementId)).get()
  if (!ent) return

  const summary = ent.terms ? deriveSummary(ent.terms) : 'Approval required'

  const policyId = randomUUID()
  const now = new Date().toISOString()
  db.insert(schema.engagementPolicies).values({
    id: policyId,
    engagementId,
    policyDocUri: null,
    policySummary: summary,
    currentState: 'draft',
    requiredSigners: 1,
    createdAt: now,
    updatedAt: now,
  }).run()

  // Default signer: the provider (issuing party). Holder may add more.
  db.insert(schema.policySigners).values({
    id: randomUUID(),
    policyId,
    agent: ent.providerAgent,
    role: 'Issuing party',
    signedAt: null,
    createdAt: now,
  }).run()
}

function deriveSummary(termsJson: string): string {
  try {
    const t = JSON.parse(termsJson) as { topic?: string; scope?: string; object?: string }
    return t.topic ?? t.scope ?? `Approval for ${(t.object ?? 'governance').split(':').pop()}`
  } catch {
    return 'Approval required'
  }
}

// ─── Reads ─────────────────────────────────────────────────────────

export async function getPolicy(engagementId: string): Promise<PolicyView | null> {
  await ensurePolicy(engagementId)
  const policyRow = db.select().from(schema.engagementPolicies)
    .where(eq(schema.engagementPolicies.engagementId, engagementId)).get()
  if (!policyRow) return null
  const signers = await db.select().from(schema.policySigners)
    .where(eq(schema.policySigners.policyId, policyRow.id))
    .orderBy(asc(schema.policySigners.createdAt))
  const signerViews = signers.map(rowToSigner)
  return {
    ...rowToPolicy(policyRow),
    signers: signerViews,
    signedCount: signerViews.filter(s => s.signedAt !== null).length,
  }
}

// ─── Mutators ──────────────────────────────────────────────────────

export async function setPolicy(input: {
  engagementId: string
  policyDocUri?: string
  policySummary?: string
  requiredSigners?: number
}): Promise<{ ok: true } | { error: string }> {
  const auth = await authorizeRole(input.engagementId)
  if ('error' in auth) return auth
  if (auth.role !== 'provider') return { error: 'only-provider-may-set-policy' }
  await ensurePolicy(input.engagementId)
  const policy = db.select().from(schema.engagementPolicies)
    .where(eq(schema.engagementPolicies.engagementId, input.engagementId)).get()
  if (!policy) return { error: 'policy-not-found' }
  const update: Partial<typeof schema.engagementPolicies.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (input.policyDocUri !== undefined) update.policyDocUri = input.policyDocUri || null
  if (input.policySummary !== undefined) update.policySummary = input.policySummary || null
  if (input.requiredSigners !== undefined && input.requiredSigners >= 1) update.requiredSigners = input.requiredSigners
  db.update(schema.engagementPolicies).set(update)
    .where(eq(schema.engagementPolicies.id, policy.id))
    .run()
  return { ok: true }
}

export async function addSigner(input: {
  engagementId: string
  agentAddress: string
  role: string
}): Promise<{ ok: true } | { error: string }> {
  const auth = await authorizeRole(input.engagementId)
  if ('error' in auth) return auth
  if (auth.role !== 'provider' && auth.role !== 'holder') return { error: 'not-a-party' }
  await ensurePolicy(input.engagementId)
  const policy = db.select().from(schema.engagementPolicies)
    .where(eq(schema.engagementPolicies.engagementId, input.engagementId)).get()
  if (!policy) return { error: 'policy-not-found' }
  const lower = input.agentAddress.toLowerCase()
  const existing = db.select().from(schema.policySigners)
    .where(and(
      eq(schema.policySigners.policyId, policy.id),
      eq(schema.policySigners.agent, lower),
    )).get()
  if (existing) return { error: 'signer-already-on-roster' }

  db.insert(schema.policySigners).values({
    id: randomUUID(),
    policyId: policy.id,
    agent: lower,
    role: input.role,
    signedAt: null,
    createdAt: new Date().toISOString(),
  }).run()

  // Bump requiredSigners minimum to roster size if it was set lower.
  const total = db.select().from(schema.policySigners)
    .where(eq(schema.policySigners.policyId, policy.id))
    .all().length
  if (policy.requiredSigners < total) {
    db.update(schema.engagementPolicies)
      .set({ requiredSigners: total, updatedAt: new Date().toISOString() })
      .where(eq(schema.engagementPolicies.id, policy.id))
      .run()
  }
  return { ok: true }
}

export async function signPolicy(input: {
  engagementId: string
}): Promise<{ ok: true; reachedThreshold: boolean } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()
  await ensurePolicy(input.engagementId)
  const policy = db.select().from(schema.engagementPolicies)
    .where(eq(schema.engagementPolicies.engagementId, input.engagementId)).get()
  if (!policy) return { error: 'policy-not-found' }

  const signer = db.select().from(schema.policySigners)
    .where(and(
      eq(schema.policySigners.policyId, policy.id),
      eq(schema.policySigners.agent, lower),
    )).get()
  if (!signer) return { error: 'not-on-signer-roster' }
  if (signer.signedAt) return { error: 'already-signed' }

  const now = new Date().toISOString()
  db.update(schema.policySigners)
    .set({ signedAt: now })
    .where(eq(schema.policySigners.id, signer.id))
    .run()

  // Move policy state forward.
  const allSigners = db.select().from(schema.policySigners)
    .where(eq(schema.policySigners.policyId, policy.id))
    .all()
  const signedCount = allSigners.filter(s => s.signedAt !== null).length
  const reachedThreshold = signedCount >= policy.requiredSigners
  db.update(schema.engagementPolicies)
    .set({
      currentState: reachedThreshold ? 'approved' : 'pending',
      updatedAt: now,
    })
    .where(eq(schema.engagementPolicies.id, policy.id))
    .run()

  // Emit thread entry so the audit trail captures the signature.
  try {
    const { emitWitnessSig } = await import('./thread.action')
    await emitWitnessSig({
      engagementId: input.engagementId,
      witnessAgent: lower,
      signature: '0x' + Buffer.from(`policy:${policy.id}:${lower}`).toString('hex'),
      signedAt: now,
    })
  } catch { /* non-fatal */ }

  return { ok: true, reachedThreshold }
}
