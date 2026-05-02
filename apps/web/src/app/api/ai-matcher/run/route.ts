import { NextRequest, NextResponse } from 'next/server'
import { runAiMatchRound } from '@/lib/actions/engagements/ai-matcher.action'

/**
 * POST /api/ai-matcher/run?hubId=xxx
 *
 * Trigger one round of AI matching for the named hub. Used both by the
 * "Run AI matcher" button and (future) by the a2a-agent runtime that
 * polls automatically.
 */
export async function POST(req: NextRequest) {
  const hubId = req.nextUrl.searchParams.get('hubId')
  if (!hubId) return NextResponse.json({ error: 'missing hubId' }, { status: 400 })
  const r = await runAiMatchRound({ hubId })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r.result)
}
