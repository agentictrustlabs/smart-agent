import { NextResponse } from 'next/server'
import { hubSyncAll } from '@/lib/clients/hub-client'

/**
 * POST /api/ontology-sync
 *
 * Thin proxy: hub-mcp now owns the on-chain → GraphDB sync. Routing
 * through `hubSyncAll()` keeps cache invalidation co-located with the
 * write (hub-mcp clears its read caches as part of the same call).
 *
 * Direct in-process invocation is server-only and unauthenticated —
 * this admin route stays for fresh-start / smoke-test entry points
 * that already exist; production callers should hit hub-mcp directly.
 */
export async function POST() {
  try {
    const result = await hubSyncAll()
    return NextResponse.json({
      success: result.ok,
      message: result.message ?? '',
      agentCount: result.agentCount,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 },
    )
  }
}
