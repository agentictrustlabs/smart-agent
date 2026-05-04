/**
 * Canonical IRI generators (per design §8.2 / Ontologist Revision 12).
 *
 * IRIs are stable across re-syncs and used as `atl_iri` columns AND as
 * RDF subjects when GraphDB sync emits T0/T1 rows.
 */

const SAPG = 'https://smartagent.io/ontology/people-groups#'

export function conceptIri(args: { joshuaProjectId?: string; slug?: string }): string {
  if (args.joshuaProjectId) return `did:sapg:concept:${args.joshuaProjectId}`
  if (args.slug) return `${SAPG}concept-${args.slug}`
  throw new Error('conceptIri requires joshuaProjectId or slug')
}

export function collectiveIri(conceptId: string, temporalScope: string): string {
  return `${SAPG}collective-${slugify(conceptId)}-${slugify(temporalScope)}`
}

export function segmentIri(args: { principal: string; segmentSlug: string }): string {
  return `${SAPG}segment-${args.principal.toLowerCase()}-${slugify(args.segmentSlug)}`
}

export function communityIri(args: { principal: string; communitySlug: string }): string {
  return `${SAPG}community-${args.principal.toLowerCase()}-${slugify(args.communitySlug)}`
}

export function estimateIri(args: {
  segmentId: string
  recordedAt: string
  sourceFragment: string
}): string {
  return `${SAPG}estimate-${slugify(args.segmentId)}-${slugify(args.recordedAt)}-${slugify(args.sourceFragment)}`
}

export function reachednessIri(args: {
  segmentId: string
  recordedAt: string
  sourceFragment: string
}): string {
  return `${SAPG}reachedness-${slugify(args.segmentId)}-${slugify(args.recordedAt)}-${slugify(args.sourceFragment)}`
}

export function geometryIri(args: { segmentId: string; createdAt: string }): string {
  return `${SAPG}geometry-${slugify(args.segmentId)}-${slugify(args.createdAt)}`
}

export function classificationIri(args: {
  schemeId: string
  classifiedEntityIri: string
  validDuring?: string
}): string {
  const v = args.validDuring ? `-${slugify(args.validDuring)}` : ''
  return `${SAPG}classification-${slugify(args.schemeId)}-${hashFragment(args.classifiedEntityIri)}${v}`
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function hashFragment(iri: string): string {
  // Last URI fragment, slugified — stable per IRI without pulling crypto.
  const f = iri.split(/[#/]/).pop() ?? iri
  return slugify(f)
}
