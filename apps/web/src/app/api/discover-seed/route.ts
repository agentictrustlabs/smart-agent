import { NextResponse } from 'next/server'
import { seedCatalystNeedsAndOfferings } from '@/lib/demo-seed/seed-needs-resources'

/**
 * One-shot trigger for the catalyst Needs/Offerings/Matches seed. The
 * normal boot-seed lifecycle short-circuits when the on-chain hub
 * agents already exist; this endpoint lets us invoke just the
 * Discover seed after a code change without rebooting the chain.
 *
 * Idempotent — re-runs are no-ops because every insert is keyed on
 * (neededByAgent, title) and (offeredByAgent, title).
 */
export async function GET() {
  try {
    await seedCatalystNeedsAndOfferings()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
