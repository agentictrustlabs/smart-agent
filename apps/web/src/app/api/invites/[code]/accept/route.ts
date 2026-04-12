import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient, createRelationship, confirmRelationship } from '@/lib/contracts'
import {
  agentControlAbi,
  ORGANIZATION_GOVERNANCE, ORGANIZATION_MEMBERSHIP, REVIEW_RELATIONSHIP, SERVICE_AGREEMENT,
  ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER, ROLE_TREASURER, ROLE_BOARD_MEMBER,
  ROLE_AUDITOR, ROLE_OPERATOR, ROLE_EMPLOYEE, ROLE_CONTRACTOR,
  ROLE_REVIEWER, ROLE_AUTHORIZED_SIGNER, ROLE_CEO, ROLE_SERVICE_PROVIDER, ROLE_ADVISOR,
} from '@smart-agent/sdk'


/** Map role strings from invites to SDK role constants and relationship types */
const ROLE_MAP: Record<string, { role: `0x${string}`; relType: `0x${string}`; isOwner: boolean }> = {
  'owner': { role: ROLE_OWNER as `0x${string}`, relType: ORGANIZATION_GOVERNANCE as `0x${string}`, isOwner: true },
  'ceo': { role: ROLE_CEO as `0x${string}`, relType: ORGANIZATION_GOVERNANCE as `0x${string}`, isOwner: true },
  'treasurer': { role: ROLE_TREASURER as `0x${string}`, relType: ORGANIZATION_GOVERNANCE as `0x${string}`, isOwner: false },
  'authorized-signer': { role: ROLE_AUTHORIZED_SIGNER as `0x${string}`, relType: ORGANIZATION_GOVERNANCE as `0x${string}`, isOwner: true },
  'board-member': { role: ROLE_BOARD_MEMBER as `0x${string}`, relType: ORGANIZATION_GOVERNANCE as `0x${string}`, isOwner: false },
  'advisor': { role: ROLE_ADVISOR as `0x${string}`, relType: ORGANIZATION_GOVERNANCE as `0x${string}`, isOwner: false },
  'admin': { role: ROLE_ADMIN as `0x${string}`, relType: ORGANIZATION_MEMBERSHIP as `0x${string}`, isOwner: false },
  'member': { role: ROLE_MEMBER as `0x${string}`, relType: ORGANIZATION_MEMBERSHIP as `0x${string}`, isOwner: false },
  'operator': { role: ROLE_OPERATOR as `0x${string}`, relType: ORGANIZATION_MEMBERSHIP as `0x${string}`, isOwner: false },
  'employee': { role: ROLE_EMPLOYEE as `0x${string}`, relType: ORGANIZATION_MEMBERSHIP as `0x${string}`, isOwner: false },
  'contractor': { role: ROLE_CONTRACTOR as `0x${string}`, relType: SERVICE_AGREEMENT as `0x${string}`, isOwner: false },
  'service-provider': { role: ROLE_SERVICE_PROVIDER as `0x${string}`, relType: SERVICE_AGREEMENT as `0x${string}`, isOwner: false },
  'auditor': { role: ROLE_AUDITOR as `0x${string}`, relType: ORGANIZATION_MEMBERSHIP as `0x${string}`, isOwner: false },
  'reviewer': { role: ROLE_REVIEWER as `0x${string}`, relType: REVIEW_RELATIONSHIP as `0x${string}`, isOwner: false },
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

    // Get user
    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    const user = users[0]
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 400 })

    // Get or auto-deploy person agent
    let personAgents = await db.select().from(schema.personAgents)
      .where(eq(schema.personAgents.userId, user.id)).limit(1)

    if (!personAgents[0]) {
      // Auto-deploy person agent for the user
      try {
        const { deploySmartAccount } = await import('@/lib/contracts')
        const salt = BigInt(Date.now())
        const address = await deploySmartAccount(session.walletAddress as `0x${string}`, salt)
        await db.insert(schema.personAgents).values({
          id: crypto.randomUUID(),
          name: user.name,
          userId: user.id,
          smartAccountAddress: address,
          chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'),
          salt: salt.toString(),
          status: 'deployed',
        })
        personAgents = await db.select().from(schema.personAgents)
          .where(eq(schema.personAgents.userId, user.id)).limit(1)
      } catch (e) {
        console.warn('Failed to auto-deploy person agent:', e)
      }
    }

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
    if (personAgents[0]) {
      try {
        const edgeId = await createRelationship({
          subject: personAgents[0].smartAccountAddress as `0x${string}`,
          object: invite.agentAddress as `0x${string}`,
          roles: [mapping.role],
          relationshipType: mapping.relType,
        })
        await confirmRelationship(edgeId)
      } catch (e) {
        console.warn('Failed to create relationship edge (may already exist):', e)
      }
    }

    // 3. Mark invite accepted
    await db.update(schema.invites).set({
      status: 'accepted',
      acceptedBy: user.id,
      acceptedAt: new Date().toISOString(),
    }).where(eq(schema.invites.id, invite.id))

    // 4. Notify inviter
    await db.insert(schema.messages).values({
      id: crypto.randomUUID(),
      userId: invite.createdBy,
      type: 'invite_accepted',
      title: 'Invitation accepted',
      body: `${user.name} joined ${invite.agentName} as ${roleKey}`,
      link: `/team`,
    })

    // 5. Notify acceptor
    await db.insert(schema.messages).values({
      id: crypto.randomUUID(),
      userId: user.id,
      type: 'ownership_accepted',
      title: `Welcome to ${invite.agentName}`,
      body: `You are now ${roleKey} of ${invite.agentName}.`,
      link: `/dashboard`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
