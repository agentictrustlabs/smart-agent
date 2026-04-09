import { db, schema } from '@/db'
import { eq, and } from 'drizzle-orm'
import { InviteAcceptClient } from './InviteAcceptClient'

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  const invites = await db.select().from(schema.invites)
    .where(and(eq(schema.invites.code, code), eq(schema.invites.status, 'pending')))
    .limit(1)

  const invite = invites[0]

  if (!invite) {
    return (
      <main data-page="home">
        <div data-component="hero">
          <h1>Invalid Invite</h1>
          <p>This invite link is expired, already used, or doesn't exist.</p>
          <a href="/" data-component="connect-wallet-btn" data-state="disconnected">Go Home</a>
        </div>
      </main>
    )
  }

  const expired = new Date(invite.expiresAt) < new Date()
  if (expired) {
    return (
      <main data-page="home">
        <div data-component="hero">
          <h1>Invite Expired</h1>
          <p>This invite link has expired.</p>
          <a href="/" data-component="connect-wallet-btn" data-state="disconnected">Go Home</a>
        </div>
      </main>
    )
  }

  return (
    <main data-page="home">
      <div data-component="hero">
        <h1>You're Invited</h1>
        <p>You've been invited to become a <strong>{invite.role}</strong> of</p>
        <h2 style={{ color: '#6366f1', margin: '0.5rem 0' }}>{invite.agentName}</h2>
        <code data-component="address" style={{ fontSize: '0.8rem' }}>{invite.agentAddress}</code>
        <InviteAcceptClient code={code} agentName={invite.agentName} role={invite.role} />
      </div>
    </main>
  )
}
