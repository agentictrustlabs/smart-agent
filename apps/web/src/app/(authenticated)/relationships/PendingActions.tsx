'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmRelationshipAction, rejectRelationshipAction } from '@/lib/actions/confirm-relationship.action'

interface PendingActionsProps {
  edgeId: string
}

export function PendingActions({ edgeId }: PendingActionsProps) {
  const router = useRouter()
  const [acting, setActing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'confirmed' | 'rejected' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleConfirm() {
    setActing(true); setError('')
    const result = await confirmRelationshipAction(edgeId)
    setActing(false)
    if (result.success) {
      setStatus('confirmed')
      router.refresh()
    } else {
      setStatus('error')
      setError(result.error ?? 'Failed to confirm')
    }
  }

  async function handleReject() {
    setActing(true); setError('')
    const result = await rejectRelationshipAction(edgeId)
    setActing(false)
    if (result.success) {
      setStatus('rejected')
      router.refresh()
    } else {
      setStatus('error')
      setError(result.error ?? 'Failed to reject')
    }
  }

  if (status === 'confirmed') {
    return <span data-component="role-badge" data-status="active">Confirmed</span>
  }
  if (status === 'rejected') {
    return <span data-component="role-badge" data-status="revoked">Rejected</span>
  }

  return (
    <div data-component="pending-actions">
      <button onClick={handleConfirm} disabled={acting} data-component="confirm-btn">
        {acting ? 'Confirming...' : 'Confirm'}
      </button>
      <button onClick={handleReject} disabled={acting} data-component="reject-btn">
        Reject
      </button>
      {error && <span style={{ fontSize: '0.65rem', color: '#ef4444' }}>{error}</span>}
    </div>
  )
}
