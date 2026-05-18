/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event commitment.release @sa-risk-tier high @sa-validation zod @sa-owner developer */
/**
 * Spec 006 — POST /api/commitments/release
 *
 * Thin handler: parses input, delegates to `releaseTranche` from
 * `commitments.action.ts`. The action enforces donor-owner auth via
 * `canManageAgent` before signing the executeBatch delegation.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Hex } from 'viem'
import { releaseTranche } from '@/lib/actions/commitments.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const positiveBigintString = z
  .string()
  .min(1)
  .max(80)
  .refine((s) => {
    try { return BigInt(s) > 0n } catch { return false }
  }, { message: 'must parse as positive bigint' })

const BodySchema = z.object({
  commitmentSubject: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'commitmentSubject must be 32-byte hex'),
  milestoneId: z.string().min(1).max(256),
  /** bigint encoded as a decimal string — preserves precision across JSON. */
  tokenAmount: positiveBigintString,
  commitmentScaleAmount: positiveBigintString,
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const result = await releaseTranche({
    commitmentSubject: body.commitmentSubject as Hex,
    milestoneId: body.milestoneId,
    tokenAmount: BigInt(body.tokenAmount),
    commitmentScaleAmount: BigInt(body.commitmentScaleAmount),
  })
  if (!result.ok) {
    console.error('[api/commitments/release] failed:', { input: body, result })
    return NextResponse.json(result, { status: 400 })
  }
  return NextResponse.json(result)
}
