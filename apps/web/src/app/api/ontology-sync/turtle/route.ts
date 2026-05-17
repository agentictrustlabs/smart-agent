/** @sa-route dev-only @sa-prod-gate requireDev */
import { NextResponse } from 'next/server'
import { emitAgentsTurtle } from '@/lib/ontology/graphdb-sync'
import { requireDev } from '@/lib/env-guard'

/**
 * GET /api/ontology-sync/turtle
 * Returns the raw Turtle output for debugging.
 *
 * Dev-only: dumps the full agent knowledge base. Gated by requireDev()
 * so production never serves it.
 */
export async function GET() {
  const denied = requireDev()
  if (denied) return denied
  const turtle = await emitAgentsTurtle()
  return new NextResponse(turtle, {
    headers: { 'Content-Type': 'text/turtle' },
  })
}
