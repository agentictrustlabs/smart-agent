import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getEdgesByObject, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, relationshipTypeName, toDidEthr } from '@smart-agent/sdk'
import { RelationshipsClient } from './RelationshipsClient'
import { PendingActions } from './PendingActions'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { db, schema } from '@/db'
import { getControlledAgentsForUser, listRegisteredAgents } from '@/lib/agent-resolver'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const STATUS_LABELS = ['none', 'proposed', 'confirmed', 'active', 'suspended', 'revoked', 'rejected']

export default async function RelationshipsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // My agents
  const myRegisteredAgents = await getControlledAgentsForUser(currentUser.id)
  const allRegisteredAgents = await listRegisteredAgents()

  const myAgents: Array<{ address: string; name: string; did: string; type: string }> = []
  for (const a of myRegisteredAgents) {
    myAgents.push({
      address: a.address,
      name: a.name,
      did: toDidEthr(CHAIN_ID, a.address as `0x${string}`),
      type: a.kind,
    })
  }

  const allAgents: Array<{ address: string; name: string; did: string; type: string }> = []
  for (const a of allRegisteredAgents) {
    allAgents.push({
      name: a.name,
      address: a.address,
      did: toDidEthr(CHAIN_ID, a.address as `0x${string}`),
      type: a.kind,
    })
  }

  if (myAgents.length === 0) {
    return (
      <div data-page="relationships">
        <div data-component="page-header">
          <h1>Relationships</h1>
          <p>Create on-chain relationships between agents</p>
        </div>
        <div data-component="empty-state">
          <p>Deploy an agent first to create relationships.</p>
          <a href="/deploy/person">Deploy Person Agent</a>
        </div>
      </div>
    )
  }

  // Fetch existing edges for my agents
  const myAddresses = new Set(myAgents.map((a) => a.address.toLowerCase()))

  type EdgeView = {
    subject: string; subjectName: string
    object: string; objectName: string
    roles: string[]; relType: string; status: string; edgeId: string
    canConfirm: boolean  // true if I'm the object and status is proposed
    statusNum: number
  }
  const existingEdges: EdgeView[] = []
  const seenEdges = new Set<string>()

  const getName = (addr: string) => {
    const a = allAgents.find((a) => a.address.toLowerCase() === addr.toLowerCase())
    return a?.name ?? `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  for (const agent of myAgents) {
    try {
      // Edges where my agent is subject
      const subjectEdgeIds = await getEdgesBySubject(agent.address as `0x${string}`)
      for (const edgeId of subjectEdgeIds) {
        if (seenEdges.has(edgeId)) continue
        seenEdges.add(edgeId)
        const e = await getEdge(edgeId)
        const roleHashes = await getEdgeRoles(edgeId)
        // I'm subject — can I also confirm? Yes if I own the object agent too
        const iAlsoOwnObject = myAddresses.has(e.object_.toLowerCase())
        existingEdges.push({
          subject: e.subject, subjectName: getName(e.subject),
          object: e.object_, objectName: getName(e.object_),
          roles: roleHashes.map((r) => roleName(r, undefined, 'catalyst')),
          relType: relationshipTypeName(e.relationshipType, undefined, 'catalyst'),
          status: STATUS_LABELS[e.status] ?? 'unknown',
          statusNum: e.status,
          edgeId,
          canConfirm: e.status === 1 && iAlsoOwnObject, // PROPOSED and I own the object
        })
      }
      // Edges where my agent is object (proposed by someone else)
      const objectEdgeIds = await getEdgesByObject(agent.address as `0x${string}`)
      for (const edgeId of objectEdgeIds) {
        if (seenEdges.has(edgeId)) continue
        seenEdges.add(edgeId)
        const e = await getEdge(edgeId)
        const roleHashes = await getEdgeRoles(edgeId)
        existingEdges.push({
          subject: e.subject, subjectName: getName(e.subject),
          object: e.object_, objectName: getName(e.object_),
          roles: roleHashes.map((r) => roleName(r, undefined, 'catalyst')),
          relType: relationshipTypeName(e.relationshipType, undefined, 'catalyst'),
          status: STATUS_LABELS[e.status] ?? 'unknown',
          statusNum: e.status,
          edgeId,
          canConfirm: e.status === 1, // PROPOSED = 1, I'm the object
        })
      }
    } catch { /* skip */ }
  }

  return (
    <div data-page="relationships">
      <div data-component="page-header">
        <h1>Relationships</h1>
        <p>Create and view on-chain relationships between agents</p>
      </div>

      {/* Existing edges */}
      {existingEdges.length > 0 && (
        <section data-component="graph-section">
          <h2>My Relationships ({existingEdges.length})</h2>
          <table data-component="graph-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Roles</th>
                <th>To</th>
                <th>Type</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {existingEdges.map((e, i) => (
                <tr key={i}>
                  <td>{e.subjectName}</td>
                  <td data-component="role-list">
                    {e.roles.map((r, j) => <span key={j} data-component="role-badge">{r}</span>)}
                  </td>
                  <td>{e.objectName}</td>
                  <td><span data-component="role-badge">{e.relType}</span></td>
                  <td><span data-component="role-badge" data-status={e.status}>{e.status}</span></td>
                  <td>
                    {e.canConfirm ? (
                      <PendingActions edgeId={e.edgeId} />
                    ) : e.status === 'proposed' ? (
                      <span data-component="text-muted" style={{ fontSize: '0.75rem' }}>Awaiting confirmation</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Create new relationship */}
      <RelationshipsClient
        myAgents={myAgents}
        allAgents={allAgents}
      />
    </div>
  )
}
