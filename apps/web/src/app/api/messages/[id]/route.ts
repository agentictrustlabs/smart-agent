/** @sa-route web-auth @sa-auth session-cookie @sa-validation none-path-params @sa-owner developer */
import { NextResponse } from 'next/server'
import { callMcp } from '@/lib/clients/mcp-client'
import { webErrorResponse } from '@/lib/auth/error-response'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await callMcp('person', 'mark_notification_read', { id })
    return NextResponse.json({ success: true })
  } catch (err) {
    return webErrorResponse({
      publicMessage: 'Failed to mark read',
      logMessage: '[messages PUT] mark_notification_read failed',
      logFields: {
        notificationId: id,
        errorCode: 'mcp-mark-read-failed',
        // Upstream MCP message may include schema fragments — log only.
        errorMessage: err instanceof Error ? err.message : 'unknown',
      },
      status: 502,
      request,
    })
  }
}
