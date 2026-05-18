/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event attestation.cast @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { castAttestation } from '@/lib/actions/disbursements.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  proposalId: z.string().min(1).max(256),
  fundAgent: z.string().min(1).max(64),
  milestoneLabel: z.string().min(1).max(256),
  status: z.enum(['delivered', 'partial', 'disputed', 'overdue']),
  // Free-text evidence (link / hash / short note). Capped to keep the
  // attestation row a sensible size in the audit log.
  evidence: z.string().max(2048).optional(),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const r = await castAttestation(parsed.data)
  if (!r.ok) return NextResponse.json(r, { status: 400 })
  return NextResponse.json(r)
}
