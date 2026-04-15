import { NextResponse } from 'next/server'
import { emitAgentsTurtle } from '@/lib/ontology/graphdb-sync'

/**
 * GET /api/ontology-sync/turtle
 * Returns the raw Turtle output for debugging.
 */
export async function GET() {
  const turtle = await emitAgentsTurtle()
  return new NextResponse(turtle, {
    headers: { 'Content-Type': 'text/turtle' },
  })
}
