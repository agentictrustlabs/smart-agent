'use server'

import { requireSession } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { callMcp } from '@/lib/clients/mcp-client'

// Proposals moved to org-mcp. On-chain governance state (AgentControl) remains
// canonical for vote tallying; this layer caches off-chain proposal detail
// (title, body, kind) and surfaces it to UIs.

export async function createProposal(data: {
  orgAddress: string
  title: string
  description: string
  actionType: 'pause-capital' | 'graduate-wave' | 'escalate-review' | 'general'
  targetAddress?: string
}) {
  await requireSession()
  await callMcp('org', 'create_proposal', {
    kind: data.actionType,
    title: data.title,
    description: data.description,
    targetAddress: data.targetAddress,
    quorumRequired: 2,
  })
  revalidatePath('/steward')
}

export async function voteOnProposal(_proposalId: string, _vote: 'for' | 'against') {
  await requireSession()
  // Voting is on-chain (AgentControl.vote). The off-chain cache in org-mcp can
  // be updated separately via set_proposal_status when the on-chain receipt
  // is confirmed; for now this server action is a no-op pending Phase 5.
  revalidatePath('/steward')
}
