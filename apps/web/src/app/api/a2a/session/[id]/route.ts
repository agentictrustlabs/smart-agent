import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * GET /api/a2a/session/:id — Get session status
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const response = await fetch(`${A2A_AGENT_URL}/session/${id}`)
  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}

/**
 * DELETE /api/a2a/session/:id — Revoke session
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const response = await fetch(`${A2A_AGENT_URL}/session/${id}`, { method: 'DELETE' })
  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}
