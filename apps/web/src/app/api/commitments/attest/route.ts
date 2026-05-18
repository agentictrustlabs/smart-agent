/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event commitment.attest @sa-validation zod @sa-owner developer */
/**
 * Spec 006 — POST /api/commitments/attest
 *
 * Validator submits an outcome attestation for a milestone. Wraps the
 * `recordOutcome` action; the action performs the on-chain write signed
 * with the viewer's EOA (so msg.sender at recordOutcome IS the validator).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Hex } from 'viem'
import { keccak256, toHex } from 'viem'
import { recordOutcome } from '@/lib/actions/commitments.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  commitmentSubject: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'commitmentSubject must be 32-byte hex'),
  milestoneId: z.string().min(1).max(256),
  evidence: z.string().max(2048).optional(),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  // Evidence becomes a content hash; the contract stores the hash, not
  // the text. Demo keccaks the summary so it's deterministic.
  const evidenceHash = keccak256(toHex(body.evidence ?? `${body.milestoneId}:attested`))
  // Outcome id IS the milestone id — the release-side gate at
  // releaseTranche reads getOutcome(commitment, keccak(milestoneId)) and
  // requires `recordedBy != 0`. Keeping outcomeId == milestoneId means
  // one validator attestation per milestone unblocks the matching tranche.
  const result = await recordOutcome({
    commitmentSubject: body.commitmentSubject as Hex,
    outcomeId: body.milestoneId,
    evidenceHash,
  })
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 })
  }
  return NextResponse.json(result)
}
