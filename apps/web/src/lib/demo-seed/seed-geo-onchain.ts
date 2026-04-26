/**
 * Geo-feature seed.
 *
 *   1. Registers a `.geo` subtree:
 *        us.geo → colorado.us.geo → {erie, fortcollins, wellington, …}.colorado.us.geo
 *      Other states + countries follow the same pattern (georgia.us.geo,
 *      california.us.geo, maritime.tg.geo, …) so every demo agent's
 *      ATL_CITY tag has a corresponding canonical name handle.
 *
 *   2. Publishes a GeoFeatureRegistry record per city. The geometryHash
 *      and metadataURI track an off-chain GeoJSON payload (rfc 7946) we
 *      derive deterministically from the centroid + bbox below — for
 *      the demo, we don't need real polygons; the user's hand-loaded
 *      Erie WKT triple in GraphDB stays as the canonical "real"
 *      polygon and is layered through `sageo:targetFeature`.
 *
 *   3. Binds each city's `.geo` name to its featureId.
 *
 * Idempotent: every step short-circuits if the name / feature already
 * exists. Run as part of boot-seed after the per-hub seeds finish.
 */

import { getPublicClient, getWalletClient } from '@/lib/contracts'
import {
  agentNameRegistryAbi,
  agentNameResolverAbi,
  geoFeatureRegistryAbi,
  GeoFeatureClient,
  type GeoFeatureKindLabel,
  GEO_COORD_SCALE,
  namehashRoot,
} from '@smart-agent/sdk'
import { keccak256, encodePacked, toBytes, type Hex } from 'viem'

interface CitySeed {
  /** ASCII slug used as the .geo label (e.g. "fortcollins"). */
  slug: string
  /** Human-readable city name. */
  city: string
  /** State / province slug under the country root (e.g. "colorado"). */
  region: string
  regionLabel: string
  /** ISO 3166-1 alpha-2 country code (lowercase slug + uppercase tag). */
  countryCode: string
  countryTag: string
  /** Centroid + bbox in EPSG:4326 degrees. */
  centroid: [number, number]   // [lat, lon]
  bbox: [number, number, number, number]   // [minLat, minLon, maxLat, maxLon]
}

// Demo cities matching the per-hub seeds (Phase 7 city tags).
// Erie is included even though no demo cohort lives there yet — it's the
// fixture the user pre-loaded into GraphDB and tested geof:sfContains
// against. Keeping the on-chain shape parallel makes future linking trivial.
const CITIES: CitySeed[] = [
  // Catalyst (Northern Colorado)
  { slug: 'erie',         city: 'Erie',         region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.0500, -105.0500], bbox: [40.0000, -105.1000, 40.1000, -105.0000] },
  { slug: 'fortcollins',  city: 'Fort Collins', region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.5853, -105.0844], bbox: [40.4500, -105.2000, 40.7000, -104.9500] },
  { slug: 'wellington',   city: 'Wellington',   region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.7036, -105.0064], bbox: [40.6500, -105.0500, 40.7500, -104.9500] },
  { slug: 'laporte',      city: 'Laporte',      region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.6258, -105.1358], bbox: [40.6000, -105.1700, 40.6500, -105.1000] },
  { slug: 'timnath',      city: 'Timnath',      region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.5281, -104.9864], bbox: [40.5000, -105.0200, 40.5500, -104.9500] },
  { slug: 'loveland',     city: 'Loveland',     region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.3978, -105.0750], bbox: [40.3500, -105.1500, 40.4500, -104.9500] },
  { slug: 'berthoud',     city: 'Berthoud',     region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.3083, -105.0811], bbox: [40.2800, -105.1100, 40.3400, -105.0500] },
  { slug: 'johnstown',    city: 'Johnstown',    region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.3369, -104.9522], bbox: [40.3100, -104.9800, 40.3700, -104.9200] },
  { slug: 'redfeather',   city: 'Red Feather Lakes', region: 'colorado', regionLabel: 'Colorado', countryCode: 'us', countryTag: 'US',
    centroid: [40.8028, -105.5819], bbox: [40.7700, -105.6200, 40.8300, -105.5400] },
  // GlobalChurch (US scattered)
  { slug: 'atlanta',      city: 'Atlanta',      region: 'georgia',    regionLabel: 'Georgia',    countryCode: 'us', countryTag: 'US',
    centroid: [33.7490, -84.3880], bbox: [33.6500, -84.5500, 33.9000, -84.2500] },
  { slug: 'sunvalley',    city: 'Sun Valley',   region: 'california', regionLabel: 'California', countryCode: 'us', countryTag: 'US',
    centroid: [34.1759, -118.3148], bbox: [34.1500, -118.3500, 34.2000, -118.2700] },
  { slug: 'nashville',    city: 'Nashville',    region: 'tennessee',  regionLabel: 'Tennessee',  countryCode: 'us', countryTag: 'US',
    centroid: [36.1627, -86.7816], bbox: [36.0500, -87.0000, 36.3000, -86.5500] },
  { slug: 'winchester',   city: 'Winchester',   region: 'virginia',   regionLabel: 'Virginia',   countryCode: 'us', countryTag: 'US',
    centroid: [38.8951, -77.0364], bbox: [38.8500, -77.1000, 38.9500, -76.9500] },
  { slug: 'orlando',      city: 'Orlando',      region: 'florida',    regionLabel: 'Florida',    countryCode: 'us', countryTag: 'US',
    centroid: [28.8036, -81.2723], bbox: [28.7000, -81.4500, 28.9500, -81.1000] },
  { slug: 'alpharetta',   city: 'Alpharetta',   region: 'georgia',    regionLabel: 'Georgia',    countryCode: 'us', countryTag: 'US',
    centroid: [33.8421, -84.3769], bbox: [33.8000, -84.4200, 33.9000, -84.3300] },
  { slug: 'newyork',      city: 'New York',     region: 'newyork',    regionLabel: 'New York',   countryCode: 'us', countryTag: 'US',
    centroid: [40.7128, -74.0060], bbox: [40.4900, -74.2600, 40.9200, -73.7000] },
  // CIL (Togo)
  { slug: 'lome',         city: 'Lomé',         region: 'maritime',   regionLabel: 'Maritime',   countryCode: 'tg', countryTag: 'TG',
    centroid: [6.1319, 1.2228], bbox: [6.0500, 1.1500, 6.2200, 1.3000] },
]

// ─── Helpers ─────────────────────────────────────────────────────────

function nodeOf(parent: Hex, label: string): Hex {
  return keccak256(encodePacked(['bytes32', 'bytes32'], [parent, keccak256(toBytes(label))]))
}

/** Mock geometry hash — keccak of a deterministic stringified payload.
 *  Replace with real GeoJSON canonical hashing once polygon data lands. */
function syntheticGeometryHash(c: CitySeed): Hex {
  return keccak256(toBytes(JSON.stringify({
    type: 'Polygon',
    coordinates: [[
      [c.bbox[1], c.bbox[0]], [c.bbox[3], c.bbox[0]],
      [c.bbox[3], c.bbox[2]], [c.bbox[1], c.bbox[2]],
      [c.bbox[1], c.bbox[0]],
    ]],
  })))
}

function syntheticH3CoverageRoot(c: CitySeed): Hex {
  // Placeholder — Phase 6 ZK fills this with the actual Merkle root over
  // the city's H3 res-6 covering cells. For now we use a stable
  // keccak of the slug so the on-chain field is non-zero and unique.
  return keccak256(toBytes(`h3-coverage:${c.countryCode}:${c.region}:${c.slug}`))
}

function syntheticSourceSetRoot(c: CitySeed): Hex {
  return keccak256(toBytes(`source-set:demo:${c.countryCode}:${c.region}:${c.slug}`))
}

function metadataURIFor(c: CitySeed): string {
  return `https://smartagent.io/geo/${c.countryCode}/${c.region}/${c.slug}/v1.json`
}

// ─── Seed runner ─────────────────────────────────────────────────────

let inflight: Promise<void> | null = null
let completed = false

export async function seedGeoOnChain(): Promise<void> {
  if (completed) return
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const nameRegistryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}` | undefined
      const nameResolverAddr = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}` | undefined
      const featureRegistryAddr = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
      if (!nameRegistryAddr || !nameResolverAddr || !featureRegistryAddr) {
        console.warn('[geo-seed] missing env addrs — skip', { nameRegistryAddr, nameResolverAddr, featureRegistryAddr })
        return
      }
      const wc = getWalletClient()
      const pc = getPublicClient()
      const deployer = wc.account!.address as `0x${string}`

      // ─── 1. .geo namespace tree ───────────────────────────────────
      // .geo root was initialized in Deploy.s.sol; we only register the
      // country / region / city descendants here.
      const geoRoot = namehashRoot('geo')
      console.log('[geo-seed] .geo root:', geoRoot)

      async function registerName(parentNode: Hex, label: string): Promise<Hex> {
        const childNode = nodeOf(parentNode, label)
        const exists = await pc.readContract({
          address: nameRegistryAddr!, abi: agentNameRegistryAbi,
          functionName: 'recordExists', args: [childNode],
        }) as boolean
        if (!exists) {
          const hash = await wc.writeContract({
            address: nameRegistryAddr!, abi: agentNameRegistryAbi,
            functionName: 'register',
            args: [parentNode, label, deployer, nameResolverAddr!, 0n],
          })
          await pc.waitForTransactionReceipt({ hash })
        }
        return childNode
      }

      // Register country roots, then per-region nodes, then cities.
      const countryNodes: Record<string, Hex> = {}
      const regionNodes: Record<string, Hex> = {}
      const seenCountries = new Set<string>()
      const seenRegions = new Set<string>()
      for (const c of CITIES) {
        if (!seenCountries.has(c.countryCode)) {
          countryNodes[c.countryCode] = await registerName(geoRoot, c.countryCode)
          seenCountries.add(c.countryCode)
        }
        const regKey = `${c.countryCode}/${c.region}`
        if (!seenRegions.has(regKey)) {
          regionNodes[regKey] = await registerName(countryNodes[c.countryCode], c.region)
          seenRegions.add(regKey)
        }
      }

      const cityNodes: Record<string, Hex> = {}
      for (const c of CITIES) {
        const key = `${c.countryCode}/${c.region}/${c.slug}`
        cityNodes[key] = await registerName(regionNodes[`${c.countryCode}/${c.region}`], c.slug)
      }
      console.log(`[geo-seed] registered ${Object.keys(cityNodes).length} city .geo names`)

      // ─── 2. Publish GeoFeatures via GeoFeatureRegistry ────────────
      const featureClient = new GeoFeatureClient(pc, featureRegistryAddr)
      const featureIds: Record<string, Hex> = {}
      for (const c of CITIES) {
        const featureId = GeoFeatureClient.featureIdFor({
          countryCode: c.countryCode, region: c.region, city: c.slug,
        })
        featureIds[`${c.countryCode}/${c.region}/${c.slug}`] = featureId

        // Idempotent: skip if a version already exists.
        const latest = await pc.readContract({
          address: featureRegistryAddr, abi: geoFeatureRegistryAbi,
          functionName: 'latestVersion', args: [featureId],
        }) as bigint
        if (latest > 0n) continue

        try {
          const hash = await featureClient.publish(wc, {
            featureId,
            kind: 'Municipality' satisfies GeoFeatureKindLabel,
            stewardAccount: deployer,
            geometryHash: syntheticGeometryHash(c),
            h3CoverageRoot: syntheticH3CoverageRoot(c),
            sourceSetRoot: syntheticSourceSetRoot(c),
            metadataURI: metadataURIFor(c),
            centroidLat: c.centroid[0],
            centroidLon: c.centroid[1],
            bbox: c.bbox,
          })
          await pc.waitForTransactionReceipt({ hash })
        } catch (e) {
          console.warn(`[geo-seed] publish failed for ${c.slug}:`, e)
        }
      }
      console.log(`[geo-seed] published ${Object.keys(featureIds).length} GeoFeatures`)

      // ─── 3. Bind .geo name → featureId ────────────────────────────
      for (const c of CITIES) {
        const key = `${c.countryCode}/${c.region}/${c.slug}`
        const featureId = featureIds[key]
        const nameNode = cityNodes[key]
        if (!featureId || !nameNode) continue
        const bound = await pc.readContract({
          address: featureRegistryAddr, abi: geoFeatureRegistryAbi,
          functionName: 'featureForName', args: [nameNode],
        }) as Hex
        if (bound !== '0x0000000000000000000000000000000000000000000000000000000000000000') continue
        try {
          const hash = await featureClient.bindName(wc, featureId, nameNode)
          await pc.waitForTransactionReceipt({ hash })
        } catch (e) {
          console.warn(`[geo-seed] bindName failed for ${c.slug}:`, e)
        }
      }

      void GEO_COORD_SCALE  // ensure import is referenced by linter
      console.log('[geo-seed] complete')
      completed = true
    } finally {
      inflight = null
    }
  })()
  return inflight
}
