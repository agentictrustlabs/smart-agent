import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient, createRelationship, confirmRelationship } from '@/lib/contracts'
import { agentControlAbi, ORGANIZATION_GOVERNANCE, ROLE_OWNER } from '@smart-agent/sdk'

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params
    const session = await getSession()
    if (!session?.walletAddress) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Find invite
    const invites = await db.select().from(schema.invites)
      .where(and(eq(schema.invites.code, code), eq(schema.invites.status, 'pending')))
      .limit(1)

    const invite = invites[0]
    if (!invite) return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
    if (new Date(invite.expiresAt) < new Date()) return NextResponse.json({ error: 'Invite expired' }, { status: 400 })

    // Get user
    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    const user = users[0]
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 400 })

    // Get user's person agent (needed for relationship edge)
    const personAgents = await db.select().from(schema.personAgents)
      .where(eq(schema.personAgents.userId, user.id)).limit(1)

    const walletClient = getWalletClient()
    const publicClient = getPublicClient()
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`

    // 1. Add as owner on AgentControl
    if (controlAddr && invite.role === 'owner') {
      try {
        const hash = await walletClient.writeContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'addOwner',
          args: [invite.agentAddress as `0x${string}`, session.walletAddress as `0x${string}`],
        })
        await publicClient.waitForTransactionReceipt({ hash })
      } catch (e) {
        console.warn('Failed to add on-chain owner (may already exist):', e)
      }
    }

    // 2. Create ownership relationship edge: person agent → org agent [owner]
    //    This makes the org show up in the person's "my agents" list
    if (personAgents[0]) {
      try {
        const edgeId = await createRelationship({
          subject: personAgents[0].smartAccountAddress as `0x${string}`,
          object: invite.agentAddress as `0x${string}`,
          roles: [ROLE_OWNER],
          relationshipType: ORGANIZATION_GOVERNANCE,
        })

        // Auto-confirm since this is an accepted invite
        await confirmRelationship(edgeId)
      } catch (e) {
        console.warn('Failed to create relationship edge (may already exist):', e)
      }
    }

    // 3. Add the org agent to the person's "created by" list in DB
    //    so it shows in their dashboard
    try {
      // Check if org already in their list
      const existingOrg = await db.select().from(schema.orgAgents)
        .where(eq(schema.orgAgents.smartAccountAddress, invite.agentAddress)).limit(1)

      // Don't change createdBy — instead, the relationship edge is what makes it
      // show up. We could add a separate "associated orgs" table but for now
      // the relationship edge handles this.
    } catch { /* non-fatal */ }

    // 4. Mark invite accepted
    await db.update(schema.invites).set({
      status: 'accepted',
      acceptedBy: user.id,
      acceptedAt: new Date().toISOString(),
    }).where(eq(schema.invites.id, invite.id))

    // 5. Notify inviter
    await db.insert(schema.messages).values({
      id: crypto.randomUUID(),
      userId: invite.createdBy,
      type: 'invite_accepted',
      title: `Invite accepted`,
      body: `${user.name} accepted your invite to become ${invite.role} of ${invite.agentName}`,
      link: `/agents/${invite.agentAddress}`,
    })

    // 6. Notify acceptor
    await db.insert(schema.messages).values({
      id: crypto.randomUUID(),
      userId: user.id,
      type: 'ownership_accepted',
      title: `Welcome to ${invite.agentName}`,
      body: `You are now a ${invite.role} of ${invite.agentName}. The agent will appear in your dashboard.`,
      link: `/agents/${invite.agentAddress}`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
