/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event pool.updateMandate @sa-validation zod @sa-owner pm */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updatePoolMandate } from '@/lib/actions/poolAdmin.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  poolAgent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  poolIRI: z.string().min(1).max(512),
  // Mandate is canonical JSON — opaque to this route. Cap it so we
  // don't accept a multi-MB mandate that would later be hashed and
  // dispatched to the MCP.
  mandate: z.record(z.string(), z.unknown()),
  mandateURI: z.string().max(2048).optional(),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const result = await updatePoolMandate({
    ...parsed.data,
    poolAgent: parsed.data.poolAgent as `0x${string}`,
  })
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
