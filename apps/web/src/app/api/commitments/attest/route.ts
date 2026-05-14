/**
 * Spec 006 — POST /api/commitments/attest
 *
 * Validator submits an outcome attestation for a milestone. Wraps the
 * `recordOutcome` action; the action performs the on-chain write signed
 * with the viewer's EOA (so msg.sender at recordOutcome IS the validator).
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Hex } from 'viem'
import { keccak256, toHex } from 'viem'
import { recordOutcome } from '@/lib/actions/commitments.action'

export const dynamic = 'force-dynamic'

interface Body {
  commitmentSubject?: string
  milestoneId?: string
  evidence?: string
}

export async function POST(req: NextRequest) {
  let body: Body
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.commitmentSubject || !body.milestoneId) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(body.commitmentSubject)) {
    return NextResponse.json({ ok: false, error: 'commitmentSubject must be 32-byte hex' }, { status: 400 })
  }
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
