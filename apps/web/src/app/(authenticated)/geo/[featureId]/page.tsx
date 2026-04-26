import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient } from '@/lib/contracts'
import {
  geoFeatureRegistryAbi,
  geoClaimRegistryAbi,
  agentAccountResolverAbi,
  GEO_COORD_SCALE,
  ATL_PRIMARY_NAME,
  GEO_REL_SERVES_WITHIN, GEO_REL_OPERATES_IN, GEO_REL_LICENSED_IN,
  GEO_REL_COMPLETED_TASK_IN, GEO_REL_VALIDATED_PRESENCE_IN, GEO_REL_STEWARD_OF,
  GEO_REL_RESIDENT_OF, GEO_REL_ORIGIN_IN,
} from '@smart-agent/sdk'
import type { Hex } from 'viem'

const REL_LABEL: Record<string, string> = {
  [(GEO_REL_SERVES_WITHIN as string).toLowerCase()]:         'serves within',
  [(GEO_REL_OPERATES_IN as string).toLowerCase()]:           'operates in',
  [(GEO_REL_LICENSED_IN as string).toLowerCase()]:           'licensed in',
  [(GEO_REL_COMPLETED_TASK_IN as string).toLowerCase()]:     'completed task in',
  [(GEO_REL_VALIDATED_PRESENCE_IN as string).toLowerCase()]: 'validated presence in',
  [(GEO_REL_STEWARD_OF as string).toLowerCase()]:            'steward of',
  [(GEO_REL_RESIDENT_OF as string).toLowerCase()]:           'resident of',
  [(GEO_REL_ORIGIN_IN as string).toLowerCase()]:             'origin in',
}

const VISIBILITY_LABEL: Record<number, string> = {
  0: 'public', 1: 'public-coarse', 2: 'private-commit', 3: 'private-zk', 4: 'offchain-only',
}

export default async function GeoFeatureDetailPage({
  params,
}: {
  params: Promise<{ featureId: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { featureId } = await params

  const fid = featureId as Hex
  const featureRegistry = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
  const claimRegistry = process.env.GEO_CLAIM_REGISTRY_ADDRESS as `0x${string}` | undefined
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!featureRegistry || !claimRegistry) {
    return <div style={{ padding: '2rem' }}>Geo registries not deployed.</div>
  }
  const client = getPublicClient()

  let feature
  try {
    feature = (await client.readContract({
      address: featureRegistry, abi: geoFeatureRegistryAbi,
      functionName: 'getLatest', args: [fid],
    })) as {
      featureId: Hex; version: bigint; stewardAccount: `0x${string}`
      featureKind: Hex; geometryHash: Hex; h3CoverageRoot: Hex
      sourceSetRoot: Hex; metadataURI: string
      centroidLat: bigint; centroidLon: bigint
      bboxMinLat: bigint; bboxMinLon: bigint; bboxMaxLat: bigint; bboxMaxLon: bigint
      validAfter: bigint; validUntil: bigint
      active: boolean; registeredAt: bigint
    }
  } catch {
    return <div style={{ padding: '2rem' }}>Feature {featureId} not found.</div>
  }

  // Pull every claim against this feature, then resolve subject names.
  let claimIds: Hex[] = []
  try {
    claimIds = (await client.readContract({
      address: claimRegistry, abi: geoClaimRegistryAbi,
      functionName: 'claimsByFeature', args: [fid],
    })) as Hex[]
  } catch { /* */ }

  type ClaimRow = {
    claimId: Hex
    subject: `0x${string}`
    subjectName: string
    issuer: `0x${string}`
    relation: string
    visibility: number
    confidence: number
    revoked: boolean
    createdAt: number
  }
  const rows: ClaimRow[] = []
  for (const cid of claimIds) {
    try {
      const c = (await client.readContract({
        address: claimRegistry, abi: geoClaimRegistryAbi,
        functionName: 'getClaim', args: [cid],
      })) as {
        claimId: Hex; subjectAgent: `0x${string}`; issuer: `0x${string}`
        relation: Hex; visibility: number; confidence: number
        revoked: boolean; createdAt: bigint
      }
      let subjectName = `${c.subjectAgent.slice(0, 6)}…${c.subjectAgent.slice(-4)}`
      if (resolverAddr) {
        try {
          const core = (await client.readContract({
            address: resolverAddr, abi: agentAccountResolverAbi,
            functionName: 'getCore', args: [c.subjectAgent],
          })) as { displayName: string }
          if (core.displayName) subjectName = core.displayName
        } catch { /* */ }
        try {
          const pn = (await client.readContract({
            address: resolverAddr, abi: agentAccountResolverAbi,
            functionName: 'getStringProperty',
            args: [c.subjectAgent, ATL_PRIMARY_NAME as `0x${string}`],
          })) as string
          if (pn) subjectName = `${subjectName} (${pn})`
        } catch { /* */ }
      }
      rows.push({
        claimId: c.claimId,
        subject: c.subjectAgent,
        subjectName,
        issuer: c.issuer,
        relation: REL_LABEL[c.relation.toLowerCase()] ?? c.relation,
        visibility: c.visibility,
        confidence: c.confidence,
        revoked: c.revoked,
        createdAt: Number(c.createdAt),
      })
    } catch { /* skip */ }
  }
  rows.sort((a, b) => b.createdAt - a.createdAt)

  const lat = Number(feature.centroidLat) / Number(GEO_COORD_SCALE)
  const lon = Number(feature.centroidLon) / Number(GEO_COORD_SCALE)
  const minLat = Number(feature.bboxMinLat) / Number(GEO_COORD_SCALE)
  const minLon = Number(feature.bboxMinLon) / Number(GEO_COORD_SCALE)
  const maxLat = Number(feature.bboxMaxLat) / Number(GEO_COORD_SCALE)
  const maxLon = Number(feature.bboxMaxLon) / Number(GEO_COORD_SCALE)

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 920 }}>
      <div style={{ fontSize: 12, marginBottom: 8 }}>
        <Link href="/geo" style={{ color: '#3f6ee8' }}>← all features</Link>
      </div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#171c28', margin: '0 0 6px' }}>
        {feature.metadataURI.replace(/^https?:\/\/[^/]+/, '')}
      </h1>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>v{feature.version.toString()}</span>
        <span>{feature.active ? 'active' : 'inactive'}</span>
        <code>{feature.featureId.slice(0, 14)}…</code>
        <a href={feature.metadataURI} target="_blank" rel="noreferrer" style={{ color: '#3f6ee8' }}>metadata</a>
      </div>

      <section style={{ background: '#fff', border: '1px solid #ece6db', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: 12 }}>
        <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Geometry</h2>
        <div style={{ fontSize: 12, color: '#475569' }}>
          <div>centroid: <code>{lat.toFixed(4)}, {lon.toFixed(4)}</code></div>
          <div>bbox: <code>{minLat.toFixed(4)}, {minLon.toFixed(4)} → {maxLat.toFixed(4)}, {maxLon.toFixed(4)}</code></div>
          <div>geometryHash: <code style={{ fontSize: 10 }}>{feature.geometryHash}</code></div>
          <div>h3CoverageRoot: <code style={{ fontSize: 10 }}>{feature.h3CoverageRoot}</code></div>
          <div>steward: <code>{feature.stewardAccount}</code></div>
        </div>
      </section>

      <section style={{ background: '#fff', border: '1px solid #ece6db', borderRadius: 12, padding: '1rem 1.25rem' }}>
        <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
          Claims ({rows.length})
        </h2>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            No claims yet. Use the <b>Add geo claim</b> panel on the dashboard
            to mint <code>residentOf</code> / <code>operatesIn</code> / etc. against this feature.
          </div>
        )}
        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map(r => (
              <div key={r.claimId} style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                gap: 12, alignItems: 'center', fontSize: 12,
                padding: '0.5rem 0.7rem', borderBottom: '1px solid #e5e7eb',
                background: r.revoked ? '#fef2f2' : 'transparent',
              }}>
                <Link href={`/agents/${r.subject}`} style={{ fontWeight: 600, color: '#171c28', textDecoration: 'none' }}>
                  {r.subjectName}
                </Link>
                <span>{r.relation}</span>
                <span style={{ color: '#64748b' }}>{VISIBILITY_LABEL[r.visibility]}</span>
                <span style={{ color: '#64748b', textAlign: 'right' }}>
                  {r.confidence}% · {new Date(r.createdAt * 1000).toLocaleDateString()}
                  {r.revoked && <span style={{ color: '#b91c1c', marginLeft: 6 }}>revoked</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
