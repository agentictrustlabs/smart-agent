import { NextResponse } from 'next/server'
import { backfillIntentsFromLegacy } from '@/lib/actions/intents.action'

/**
 * One-shot backfill: every existing `needs` row → `intents` row with
 * direction='receive'; every `resource_offerings` row → `intents` row
 * with direction='give'. Idempotent.
 */
export async function GET() {
  try {
    const r = await backfillIntentsFromLegacy()
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
