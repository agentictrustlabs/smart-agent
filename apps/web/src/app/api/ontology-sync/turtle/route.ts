import { NextResponse } from 'next/server'

/**
 * GET /api/ontology-sync/turtle
 *
 * Thin proxy: hub-mcp owns the turtle emitter (Phase 5). We forward
 * to its `/debug/agents-turtle` HTTP endpoint and stream the response
 * back unchanged. Keep this route around so existing debug tools and
 * test scripts that fetch from the web port still work.
 */
const HUB_MCP_URL = process.env.HUB_MCP_URL ?? 'http://localhost:3900'

export async function GET() {
  try {
    const res = await fetch(`${HUB_MCP_URL}/debug/agents-turtle`)
    if (!res.ok) {
      return NextResponse.json(
        { error: `hub-mcp turtle endpoint failed: ${res.status} ${res.statusText}` },
        { status: 502 },
      )
    }
    const turtle = await res.text()
    return new NextResponse(turtle, { headers: { 'Content-Type': 'text/turtle' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Turtle fetch failed' },
      { status: 502 },
    )
  }
}
