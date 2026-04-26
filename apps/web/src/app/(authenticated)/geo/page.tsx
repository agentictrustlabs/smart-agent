import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient } from '@/lib/contracts'
import { geoFeatureRegistryAbi, GEO_COORD_SCALE } from '@smart-agent/sdk'
import type { Hex } from 'viem'

/**
 * Browse all on-chain GeoFeatures.
 *
 *   Reads GeoFeatureRegistry.allFeatures() and pulls each one's latest
 *   record (display name, kind, centroid, h3CoverageRoot, metadataURI).
 *   Lightweight — no GeoSPARQL hits here. Click a feature to open its
 *   detail page (TODO; lands with the geo claim authoring UI).
 */
export default async function GeoBrowsePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const registryAddr = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!registryAddr) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Geo features</h1>
        <p style={{ color: '#b91c1c' }}>
          GEO_FEATURE_REGISTRY_ADDRESS is not set in apps/web/.env. Run
          <code> ./scripts/fresh-start.sh </code> to redeploy contracts.
        </p>
      </div>
    )
  }

  const client = getPublicClient()

  // Pull every featureId, then fan out to read each latest record.
  let featureIds: Hex[] = []
  try {
    featureIds = (await client.readContract({
      address: registryAddr, abi: geoFeatureRegistryAbi, functionName: 'allFeatures',
    })) as Hex[]
  } catch {
    return (
      <div style={{ padding: '2rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Geo features</h1>
        <p>No features yet. Boot-seed publishes them after the hubs finish.</p>
      </div>
    )
  }

  type Row = {
    featureId: Hex
    version: bigint
    kind: Hex
    metadataURI: string
    centroidLat: number
    centroidLon: number
    active: boolean
  }

  const rows: Row[] = []
  for (const fid of featureIds) {
    try {
      const r = (await client.readContract({
        address: registryAddr, abi: geoFeatureRegistryAbi,
        functionName: 'getLatest', args: [fid],
      })) as {
        featureId: Hex; version: bigint; featureKind: Hex; metadataURI: string
        centroidLat: bigint; centroidLon: bigint; active: boolean
      }
      rows.push({
        featureId: r.featureId,
        version: r.version,
        kind: r.featureKind,
        metadataURI: r.metadataURI,
        centroidLat: Number(r.centroidLat) / Number(GEO_COORD_SCALE),
        centroidLon: Number(r.centroidLon) / Number(GEO_COORD_SCALE),
        active: r.active,
      })
    } catch { /* skip bad row */ }
  }

  // Stable sort by metadataURI so cities appear in country/region order.
  rows.sort((a, b) => a.metadataURI.localeCompare(b.metadataURI))

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 920 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#171c28', margin: 0 }}>
          Geo features
        </h1>
        <Link href="/dashboard" style={{ fontSize: 12, color: '#3f6ee8' }}>← dashboard</Link>
      </div>
      <p style={{ fontSize: 13, color: '#475569', maxWidth: 720 }}>
        On-chain <code>.geo</code> features registered in <code>GeoFeatureRegistry</code>.
        Each row is a steward-curated, versioned boundary; the canonical geometry lives
        off chain and is anchored by <code>geometryHash</code>. Boot-seed publishes
        Erie, Northern Colorado, and the demo cohorts' cities as Municipality features.
      </p>

      <div style={{ marginTop: 16 }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 13, color: '#64748b' }}>
            No features yet. Run <code>./scripts/fresh-start.sh</code> or hit
            <code> /api/boot-seed</code> to populate.
          </div>
        )}
        {rows.map(r => (
          <div key={r.featureId} style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto auto',
            gap: 12, alignItems: 'center',
            padding: '0.7rem 0.9rem', borderBottom: '1px solid #e5e7eb',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#171c28' }}>
                {r.metadataURI.replace(/^https?:\/\/[^/]+/, '')}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 10, marginTop: 2 }}>
                <code>{r.featureId.slice(0, 10)}…</code>
                <span>v{r.version.toString()}</span>
                <span>{r.active ? 'active' : 'inactive'}</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right' }}>
              {r.centroidLat.toFixed(4)}, {r.centroidLon.toFixed(4)}
            </div>
            <a
              href={r.metadataURI}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: '#3f6ee8' }}
            >
              metadata
            </a>
            <Link
              href={`/geo/${r.featureId}`}
              style={{ fontSize: 11, color: '#3f6ee8', fontWeight: 600 }}
            >
              view →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
