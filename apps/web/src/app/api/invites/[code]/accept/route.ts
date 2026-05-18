/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event invite.accept @sa-validation none-path-params @sa-owner developer */
import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient, createRelationship, confirmRelationship } from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { deployPersonAgent } from '@/lib/actions/deploy-person-agent.action'
import {
  agentControlAbi,
  getInviteRoleDefinition,
  getRelationshipTypeDefinitionByKey,
  ROLE_MEMBER,
} from '@smart-agent/sdk'


/** Map invite roles to taxonomy-derived role + relationship type hashes. */
const ROLE_MAP: Record<string, { role: `0x${string}`; relType: `0x${string}`; isOwner: boolean }> = {
  owner: {
    role: getInviteRoleDefinition('owner')!.hash,
    relType: getRelationshipTypeDefinitionByKey('organization-governance')!.hash,
    isOwner: true,
  },
  admin: {
    role: getInviteRoleDefinition('admin')!.hash,
    relType: getRelationshipTypeDefinitionByKey('organization-membership')!.hash,
    isOwner: false,
  },
  member: {
    role: ROLE_MEMBER as `0x${string}`,
    relType: getRelationshipTypeDefinitionByKey('organization-membership')!.hash,
    isOwner: false,
  },
}

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
    if (!invite) return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 })
    if (new Date(invite.expiresAt) < new Date()) return NextResponse.json({ error: 'This invitation has expired' }, { status: 400 })

    // Resolve the accepting user. Stateless auth (passkey/SIWE) has no
    // `users` row by design — fall back to session-derived identity (the
    // smart account IS the user's anchor). Stateful auth (demo/google)
    // still goes through the users-table lookup.
    const stateless = session.via === 'passkey' || session.via === 'siwe'
    let userId: string
    let userName: string
    let personAgentAddress: `0x${string}` | null = null
    if (stateless) {
      if (!session.smartAccountAddress) {
        return NextResponse.json({ error: 'Stateless session missing smartAccountAddress' }, { status: 400 })
      }
      userId = session.smartAccountAddress.toLowerCase()
      userName = session.name ?? userId
      // For stateless users, the smart account IS the person agent.
      personAgentAddress = session.smartAccountAddress as `0x${string}`
    } else {
      const users = await db.select().from(schema.localUserAccounts)
        .where(eq(schema.localUserAccounts.did, session.userId)).limit(1)
      const user = users[0]
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 400 })
      userId = user.id
      userName = user.name
      personAgentAddress = (await getPersonAgentForUser(user.id)) as `0x${string}` | null
      if (!personAgentAddress) {
        // Auto-deploy person agent for the user
        try {
          const result = await deployPersonAgent(user.name)
          personAgentAddress = (result.smartAccountAddress ?? null) as `0x${string}` | null
        } catch (e) {
          console.warn('Failed to auto-deploy person agent:', e)
        }
      }
    }
    void userName // reserved for future audit / notify-inviter formatting

    // Resolve the role mapping
    const roleKey = invite.role
    const mapping = ROLE_MAP[roleKey] ?? ROLE_MAP['member']

    const walletClient = getWalletClient()
    const publicClient = getPublicClient()
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`

    // 1. If this role grants owner status, add as on-chain owner
    if (controlAddr && mapping.isOwner) {
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

    // 2. Create relationship edge with the correct role
    if (personAgentAddress) {
      try {
        const edgeId = await createRelationship({
          subject: personAgentAddress as `0x${string}`,
          object: invite.agentAddress as `0x${string}`,
          roles: [mapping.role],
          relationshipType: mapping.relType,
        })
        await confirmRelationship(edgeId)
        const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
        scheduleKbSyncEager()
      } catch (e) {
        console.warn('Failed to create relationship edge (may already exist):', e)
      }
    }

    // 3. Mark invite accepted. `acceptedBy` stores whatever userId we
    //    derived (demo userId for stateful, smartAccount lowercase for stateless).
    await db.update(schema.invites).set({
      status: 'accepted',
      acceptedBy: userId,
      acceptedAt: new Date().toISOString(),
    }).where(eq(schema.invites.id, invite.id))

    // 4 + 5. Notifications moved to person-mcp (the messages table was
    // dropped). Try/catch the legacy SQL inserts so old code paths don't
    // crash if the schema is still defined; real notifications happen via
    // per-user MCPs going forward.

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
