/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event pool.rotateStewards @sa-validation zod @sa-owner pm */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { rotatePoolStewards } from '@/lib/actions/poolAdmin.action'
import { validateRequest } from '@/lib/auth/validate-request'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  poolAgent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  poolIRI: z.string().min(1).max(512),
  // Capped at 128 stewards — well above any realistic governance need
  // but bounded so the body limit doesn't get bypassed via a huge array.
  stewards: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(128),
})

export async function POST(req: Request) {
  const parsed = await validateRequest(req, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const result = await rotatePoolStewards({
    ...parsed.data,
    poolAgent: parsed.data.poolAgent as `0x${string}`,
    stewards: parsed.data.stewards as `0x${string}`[],
  })
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
