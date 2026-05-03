import { NextResponse } from 'next/server'
import { callMcp } from '@/lib/clients/mcp-client'

export async function PUT(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await callMcp('person', 'mark_notification_read', { id })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to mark read' },
      { status: 502 },
    )
  }
}
