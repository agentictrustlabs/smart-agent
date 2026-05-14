/**
 * Spec 006 — POST /api/commitments/release
 *
 * Thin handler: parses input, delegates to `releaseTranche` from
 * `commitments.action.ts`. The action enforces donor-owner auth via
 * `canManageAgent` before signing the executeBatch delegation.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Hex } from 'viem'
import { releaseTranche } from '@/lib/actions/commitments.action'

export const dynamic = 'force-dynamic'

interface Body {
  commitmentSubject?: string
  milestoneId?: string
  /** bigint encoded as a decimal string — preserves precision across JSON. */
  tokenAmount?: string
  commitmentScaleAmount?: string
}

export async function POST(req: NextRequest) {
  let body: Body
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }
  if (!body.commitmentSubject || !body.milestoneId || !body.tokenAmount || !body.commitmentScaleAmount) {
    return NextResponse.json({ ok: false, error: 'missing-required-fields' }, { status: 400 })
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(body.commitmentSubject)) {
    return NextResponse.json({ ok: false, error: 'commitmentSubject must be 32-byte hex' }, { status: 400 })
  }
  let tokenAmount: bigint
  let commitmentScaleAmount: bigint
  try {
    tokenAmount = BigInt(body.tokenAmount)
    commitmentScaleAmount = BigInt(body.commitmentScaleAmount)
  } catch {
    return NextResponse.json({ ok: false, error: 'amounts must parse as bigint' }, { status: 400 })
  }
  if (tokenAmount <= 0n || commitmentScaleAmount <= 0n) {
    return NextResponse.json({ ok: false, error: 'amount must be positive' }, { status: 400 })
  }
  const result = await releaseTranche({
    commitmentSubject: body.commitmentSubject as Hex,
    milestoneId: body.milestoneId,
    tokenAmount,
    commitmentScaleAmount,
  })
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 })
  }
  return NextResponse.json(result)
}
