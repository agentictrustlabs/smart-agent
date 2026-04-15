import { NextResponse } from 'next/server'
import { syncOnChainToGraphDB } from '@/lib/ontology/graphdb-sync'

/**
 * POST /api/ontology-sync
 * Triggers a full on-chain → GraphDB sync.
 */
export async function POST() {
  try {
    const result = await syncOnChainToGraphDB()
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 },
    )
  }
}
