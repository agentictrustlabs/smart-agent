import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getAgentKind } from '@/lib/agent-registry'
import { getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, relationshipTypeName } from '@smart-agent/sdk'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { NetworkMapView } from '@/components/graph/NetworkMapView'

const STATUS_NAMES = ['None', 'Proposed', 'Confirmed', 'Active', 'Suspended', 'Revoked', 'Rejected']

export default async function CatalystMapPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  if (userOrgs.length === 0) return <p>No organizations found.</p>

  // Collect all addresses
  const allAddresses = new Set<string>()
  for (const org of userOrgs) {
    allAddresses.add(org.address.toLowerCase())
    try {
      const connected = await getConnectedOrgs(org.address)
      for (const c of connected) allAddresses.add(c.address.toLowerCase())
    } catch { /* ignored */ }
  }

  // Build agents with geo
  type MapAgent = { address: string; name: string; type: 'person' | 'org' | 'ai'; latitude: number; longitude: number }
  const agents: MapAgent[] = []
  const geoAddrs = new Set<string>()

  for (const addr of allAddresses) {
    try {
      const meta = await getAgentMetadata(addr)
      const lat = parseFloat(meta.latitude) || 0
      const lon = parseFloat(meta.longitude) || 0
      if (lat === 0 && lon === 0) continue
      const kind = await getAgentKind(addr)
      if (kind === 'hub') continue
      geoAddrs.add(addr)
      agents.push({
        address: addr, name: meta.displayName,
        type: kind === 'org' ? 'org' : kind === 'ai' ? 'ai' : 'person',
        latitude: lat, longitude: lon,
      })
    } catch { /* ignored */ }
  }

  // Build edges
  type MapEdge = { sourceAddr: string; targetAddr: string; roles: string[]; relationshipType: string; status: string; edgeId: string }
  const edges: MapEdge[] = []
  const seenEdges = new Set<string>()

  for (const addr of geoAddrs) {
    try {
      for (const edgeId of await getEdgesBySubject(addr as `0x${string}`)) {
        if (seenEdges.has(edgeId)) continue
        const edge = await getEdge(edgeId)
        if (!geoAddrs.has(edge.object_.toLowerCase())) continue
        seenEdges.add(edgeId)
        const roles = (await getEdgeRoles(edgeId)).map(r => roleName(r, undefined, 'catalyst'))
        edges.push({
          sourceAddr: edge.subject, targetAddr: edge.object_,
          roles, relationshipType: relationshipTypeName(edge.relationshipType, undefined, 'catalyst'),
          status: STATUS_NAMES[edge.status] ?? 'Unknown', edgeId,
        })
      }
    } catch { /* ignored */ }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Map</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Geographic view of all groups with relationships. Click agents or relationship lines for details.
        </p>
      </div>
      {agents.length === 0 ? (
        <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>No agents with location data.</p>
      ) : (
        <NetworkMapView agents={agents} edges={edges} />
      )}
    </div>
  )
}
