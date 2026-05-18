/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event disbursement.markPaid @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { markDisbursementPaid } from '@/lib/actions/disbursements.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  disbursementId: z.string().min(1).max(256),
  fundAgent: z.string().min(1).max(64),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const r = await markDisbursementPaid(parsed.data)
  if (!r.ok) return NextResponse.json(r, { status: 400 })
  return NextResponse.json(r)
}
