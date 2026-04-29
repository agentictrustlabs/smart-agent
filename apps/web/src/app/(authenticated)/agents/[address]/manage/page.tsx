import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { AddSkillClaimPanel } from '@/components/profile/AddSkillClaimPanel'
import { AddGeoClaimPanel } from '@/components/profile/AddGeoClaimPanel'
import { AgentSubNav } from '@/components/nav/AgentSubNav'

/**
 * /agents/[address]/manage — owner-gated authoring surface.
 *
 * Lets the connected user publish skill / geo claims AS the target
 * agent (the org / AI agent / family / hub they own or control), in
 * one place. Mirrors the per-person `AddSkillClaimPanel` and
 * `AddGeoClaimPanel` already on the hub dashboard, but rebound so the
 * subject is the target agent rather than the caller's person agent.
 *
 * Authority is checked twice:
 *   1. This route: `canManageAgent` short-circuits to 404 for non-owners.
 *   2. Server actions (mint*Action): re-verify authority before
 *      broadcasting, so a malicious client can't bypass the gate.
 *
 * Existing surfaces that already cover other org-level concerns:
 *   • Trust & Compliance tab (page.tsx in this folder) — governance,
 *     review delegations, controllers.
 *   • Profile tab (`/metadata`) — display name, description,
 *     capabilities, A2A / MCP endpoints, primary `.agent` name.
 *   • Chat tab (`/communicate`) — A2A messaging.
 * The Manage tab is for the on-chain claim authoring those surfaces
 * don't reach.
 */
export default async function ManageAgentPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  const me = await getCurrentUser()
  if (!me) redirect('/')

  const target = address as `0x${string}`
  const personAgent = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
  if (!personAgent) redirect('/onboarding')

  // Hide rather than 403 — leaves no breadcrumb for non-owners poking
  // at URLs. Same convention as the existing org viewer pages.
  const allowed = await canManageAgent(personAgent, target)
  if (!allowed) notFound()

  const meta = await getAgentMetadata(target)
  const displayName = meta.displayName || `${target.slice(0, 6)}…${target.slice(-4)}`

  return (
    <div data-component="agent-page">
      <AgentSubNav address={target} />

      <header style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{displayName}</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 4 }}>
          Manage on-chain claims published by this agent.{' '}
          <Link href={`/agents/${target}/metadata`}>Profile</Link> covers
          display name, capabilities, and endpoints;{' '}
          <Link href={`/agents/${target}`}>Trust &amp; Compliance</Link>{' '}
          handles governance, controllers, and reviews.
        </p>
      </header>

      <AddSkillClaimPanel subjectAgent={target} subjectLabel={displayName} />
      <AddGeoClaimPanel subjectAgent={target} subjectLabel={displayName} />
    </div>
  )
}
