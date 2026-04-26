/**
 * GeoSPARQL helpers for the .geo namespace.
 *
 * The GraphDB SmartAgents repository has the GeoSPARQL plugin enabled
 * (geohash prefix tree, precision 11) — these wrappers are thin SPARQL
 * builders that hit it server-side instead of importing polygon math
 * into the discovery SDK.
 *
 * IRI conventions match the user's pre-loaded Erie fixture:
 *   feature   = https://smartagent.io/geo/<path>
 *   geometry  = <feature>/geom/v<n>     (versioned)
 *   wkt       = "POLYGON((...))"^^<http://www.opengis.net/ont/geosparql#wktLiteral>
 *
 * Public claims that reference a feature use sageo:targetFeature; the
 * agent (subject) is identified by `sa:onChainAddress` so the join back
 * to AgentAccountResolver works without a separate IRI resolver.
 */
import { PREFIXES } from './sparql'
import type { GraphDBClient } from './graphdb-client'

const GEO_PREFIXES = `
${PREFIXES}
PREFIX geo:   <http://www.opengis.net/ont/geosparql#>
PREFIX geof:  <http://www.opengis.net/def/function/geosparql/>
PREFIX sageo: <https://smartagent.io/ontology/geo#>
PREFIX san:   <https://smartagent.io/ontology/namespace#>
`

export interface GeoFeatureRef {
  iri: string
  wkt: string
  /** Versioned geometry IRI (e.g. .../geom/v1). */
  geomIri: string
}

/** Features whose geometry contains the supplied point (lon, lat in EPSG:4326). */
export function featuresContainingPointQuery(lon: number, lat: number): string {
  return `${GEO_PREFIXES}
SELECT ?feature ?geom ?wkt WHERE {
  ?feature a geo:Feature ;
           geo:hasGeometry ?geom .
  ?geom geo:asWKT ?wkt .
  FILTER(geof:sfContains(?wkt, "POINT(${lon} ${lat})"^^geo:wktLiteral))
}`
}

/** Features whose geometry intersects the supplied WKT (polygon, line, etc.). */
export function featuresIntersectingWktQuery(wkt: string): string {
  return `${GEO_PREFIXES}
SELECT ?feature ?geom ?wkt WHERE {
  ?feature a geo:Feature ;
           geo:hasGeometry ?geom .
  ?geom geo:asWKT ?wkt .
  FILTER(geof:sfIntersects(?wkt, ${JSON.stringify(wkt)}^^geo:wktLiteral))
}`
}

/** Features within a given distance (km) of a point. */
export function featuresWithinKmQuery(lon: number, lat: number, km: number): string {
  // geof:distance returns metres in EPSG:4326 by default with the
  // geohash plugin; convert km → m here.
  const m = km * 1000
  return `${GEO_PREFIXES}
SELECT ?feature ?geom ?wkt (geof:distance(?wkt, "POINT(${lon} ${lat})"^^geo:wktLiteral) AS ?distM) WHERE {
  ?feature a geo:Feature ;
           geo:hasGeometry ?geom .
  ?geom geo:asWKT ?wkt .
  FILTER(geof:distance(?wkt, "POINT(${lon} ${lat})"^^geo:wktLiteral) <= ${m})
}
ORDER BY ?distM`
}

/**
 * Agents that have a public sageo:GeoClaim against any feature containing
 * the supplied point. Used by the trust-search action's geo path to find
 * "agents who serve this point" without computing in JS.
 */
export function agentsClaimingFeatureContainingPointQuery(
  lon: number, lat: number, relations?: string[]
): string {
  const relFilter = relations && relations.length > 0
    ? `FILTER(?relation IN (${relations.map(r => `sageo:${r}`).join(', ')}))`
    : ''
  return `${GEO_PREFIXES}
SELECT DISTINCT ?agent ?feature ?relation WHERE {
  ?feature a geo:Feature ;
           geo:hasGeometry/geo:asWKT ?wkt .
  FILTER(geof:sfContains(?wkt, "POINT(${lon} ${lat})"^^geo:wktLiteral))
  ?claim a sageo:GeoClaim ;
         sageo:targetFeature ?feature ;
         sageo:relation ?relation ;
         sageo:subjectAgent ?agent .
  ${relFilter}
}`
}

/**
 * For a given agent, list every public geo claim with the feature
 * canonical IRI. Used to render an agent's "operates in / lives in"
 * badge list. The agent IRI matches the `agentIRI()` scheme used in
 * apps/web/src/lib/ontology/graphdb-sync.ts: `https://smartagent.io/
 * ontology/core#agent/<lowercase-address>`.
 */
export function geoClaimsForAgentQuery(agentAddress: string): string {
  const agent = `<https://smartagent.io/ontology/core#agent/${agentAddress.toLowerCase()}>`
  return `${GEO_PREFIXES}
SELECT ?claim ?feature ?relation ?visibility ?policyId WHERE {
  ?claim a sageo:GeoClaim ;
         sageo:subjectAgent ${agent} ;
         sageo:targetFeature ?feature ;
         sageo:relation ?relation ;
         sageo:visibility ?visibility ;
         sageo:policyId ?policyId .
}`
}

// ─── DiscoveryService extension wrappers ────────────────────────────

export class GeoDiscoveryClient {
  constructor(private readonly client: GraphDBClient) {}

  async featuresContainingPoint(lon: number, lat: number): Promise<GeoFeatureRef[]> {
    const r = await this.client.query(featuresContainingPointQuery(lon, lat))
    return r.results.bindings.map(b => ({
      iri: b.feature.value,
      geomIri: b.geom.value,
      wkt: b.wkt.value,
    }))
  }

  async featuresWithinKm(lon: number, lat: number, km: number): Promise<Array<GeoFeatureRef & { distMeters: number }>> {
    const r = await this.client.query(featuresWithinKmQuery(lon, lat, km))
    return r.results.bindings.map(b => ({
      iri: b.feature.value,
      geomIri: b.geom.value,
      wkt: b.wkt.value,
      distMeters: parseFloat(b.distM.value),
    }))
  }

  async agentsClaimingFeatureContainingPoint(
    lon: number, lat: number, relations?: string[]
  ): Promise<Array<{ agent: string; feature: string; relation: string }>> {
    const r = await this.client.query(agentsClaimingFeatureContainingPointQuery(lon, lat, relations))
    return r.results.bindings.map(b => ({
      agent: b.agent.value,
      feature: b.feature.value,
      relation: b.relation.value,
    }))
  }
}
