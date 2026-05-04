/**
 * Org-viewer "People-Group Focus" section.
 *
 * Renders the segments table + multi-source estimates + reachedness + community
 * + geometry for an org that sponsors people-group research.
 *
 * Auth branches:
 *  - Caller is the sponsor org (direct session principal == org address): full T2.
 *  - Caller has an on-chain cross-delegation from the sponsor: bridged T2.
 *  - Otherwise: only T1 segment registrations (display_name, scope, place).
 */

import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getOrgCrossDelegation } from '@/lib/demo-seed/seed-org-delegations'
import { bootstrapA2ASessionForUser } from '@/lib/actions/a2a-session.action'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const PG_AUDIENCE = 'urn:mcp:server:people-groups'
const PG_DIRECT = process.env.PEOPLE_GROUP_MCP_URL ?? 'http://localhost:3300'

interface SegmentRow {
  id: string
  atlIri: string
  principal: string
  conceptId: string
  scopeTypeId: string
  spatialFeatureId: string | null
  parentSegmentId: string | null
  displayName: string | null
  visibility: string
  temporalScope: string | null
}

interface Estimate {
  id: string; segmentId: string; populationCount: number | null
  percentChristian: number | null; percentEvangelical: number | null
  confidenceScore: number | null; sourceRecordIri: string | null
  recordedAt: string
}

interface Reachedness {
  id: string; segmentId: string
  reachednessStatusIri: string | null; engagementStatusIri: string | null
  confidenceScore: number | null; sourceRecordIri: string | null
  recordedAt: string
}

interface Community {
  id: string; segmentId: string
  displayName: string; cohesionBasis?: string | null; locationHint?: string
  isAgentive: boolean
}

interface FocusData {
  authMode: 'sponsor' | 'delegated' | 'public'
  segments: SegmentRow[]
  estimatesBySegment: Record<string, Estimate[]>
  reachednessBySegment: Record<string, Reachedness[]>
  communitiesBySegment: Record<string, Community[]>
}

async function publicSegmentsOnly(orgAddress: string): Promise<SegmentRow[]> {
  // Read T1 directly via the public list_segments tool (no auth path).
  const r = await fetch(`${PG_DIRECT}/tools/list_segments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: { sponsorPrincipal: orgAddress } }),
  })
  if (!r.ok) return []
  const data = await r.json() as { segments?: SegmentRow[] }
  return (data.segments ?? []).filter(s => s.visibility === 'public')
}

async function callPg<T = Record<string, unknown>>(args: {
  sessionId: string
  tool: string
  body: Record<string, unknown>
}): Promise<T | { error: string }> {
  const res = await fetch(`${A2A_AGENT_URL}/mcp/people-group/${args.tool}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${args.sessionId}` },
    body: JSON.stringify(args.body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { error: err.error ?? `MCP people-group.${args.tool} ${res.status}` }
  }
  return res.json() as Promise<T>
}

async function loadFocusData(orgAddress: string): Promise<FocusData | null> {
  const me = await getCurrentUser()
  // Public-only path: no current user.
  if (!me) {
    const segs = await publicSegmentsOnly(orgAddress)
    if (segs.length === 0) return null
    return { authMode: 'public', segments: segs, estimatesBySegment: {}, reachednessBySegment: {}, communitiesBySegment: {} }
  }

  const user = await db.select().from(schema.users).where(eq(schema.users.id, me.id)).get()
  if (!user?.smartAccountAddress || !user?.privateKey) {
    const segs = await publicSegmentsOnly(orgAddress)
    if (segs.length === 0) return null
    return { authMode: 'public', segments: segs, estimatesBySegment: {}, reachednessBySegment: {}, communitiesBySegment: {} }
  }

  const isSponsor = user.smartAccountAddress.toLowerCase() === orgAddress.toLowerCase()
  let crossDelegation: unknown = null
  if (!isSponsor) {
    const cross = await getOrgCrossDelegation(orgAddress, me.id, PG_AUDIENCE)
    if (!cross) {
      const segs = await publicSegmentsOnly(orgAddress)
      if (segs.length === 0) return null
      return { authMode: 'public', segments: segs, estimatesBySegment: {}, reachednessBySegment: {}, communitiesBySegment: {} }
    }
    crossDelegation = cross.delegation
  }

  const r = await bootstrapA2ASessionForUser({
    smartAccountAddress: user.smartAccountAddress, privateKey: user.privateKey,
  })
  if (!r.success || !r.sessionId) return null

  const segRes = await callPg<{ segments?: SegmentRow[] }>({
    sessionId: r.sessionId,
    tool: 'list_segments',
    body: { sponsorPrincipal: orgAddress, ...(crossDelegation ? { crossDelegation } : {}) },
  })
  if ('error' in segRes) return null
  const segments = segRes.segments ?? []
  if (segments.length === 0) return null

  const estimatesBySegment: Record<string, Estimate[]> = {}
  const reachednessBySegment: Record<string, Reachedness[]> = {}
  const communitiesBySegment: Record<string, Community[]> = {}

  for (const s of segments) {
    const e = await callPg<{ estimates?: Estimate[] }>({
      sessionId: r.sessionId, tool: 'list_estimates_for_segment',
      body: { segmentId: s.id, ...(crossDelegation ? { crossDelegation } : {}) },
    })
    estimatesBySegment[s.id] = ('error' in e) ? [] : (e.estimates ?? [])

    const ra = await callPg<{ assessments?: Reachedness[] }>({
      sessionId: r.sessionId, tool: 'list_reachedness_for_segment',
      body: { segmentId: s.id, ...(crossDelegation ? { crossDelegation } : {}) },
    })
    reachednessBySegment[s.id] = ('error' in ra) ? [] : (ra.assessments ?? [])

    const c = await callPg<{ communities?: Community[] }>({
      sessionId: r.sessionId, tool: 'list_communities',
      body: { segmentId: s.id, ...(crossDelegation ? { crossDelegation } : {}) },
    })
    communitiesBySegment[s.id] = ('error' in c) ? [] : (c.communities ?? [])
  }

  return {
    authMode: isSponsor ? 'sponsor' : 'delegated',
    segments, estimatesBySegment, reachednessBySegment, communitiesBySegment,
  }
}

const SAPG = 'https://smartagent.io/ontology/people-groups#'

const SCOPE_LABELS: Record<string, string> = {
  'scope-pgac': 'PGAC', 'scope-pgic': 'PGIC',
  'scope-region': 'Region', 'scope-admin': 'AdminArea',
  'scope-city': 'InCity', 'scope-place': 'InPlace',
  'scope-poly': 'InPolygon', 'scope-diasp': 'InDiaspora',
  'scope-lang': 'InLanguage', 'scope-relig': 'InReligion',
  'scope-caste': 'InCasteClanTribe', 'scope-affin': 'InAffinityGroup',
  'scope-clust': 'InCluster',
  'scope-church': 'InChurch', 'scope-net': 'InNetwork', 'scope-denom': 'InDenomination',
  'scope-eng': 'InMinistryEngagement', 'scope-rea': 'ReachednessScope',
}

const STATUS_LABEL: Record<string, string> = {
  [`${SAPG}StatusUnreached`]: 'Unreached',
  [`${SAPG}StatusReached`]: 'Reached',
  [`${SAPG}StatusFrontier`]: 'Frontier PG',
  [`${SAPG}StatusEngaged`]: 'Engaged',
  [`${SAPG}StatusUnengaged`]: 'Unengaged',
  [`${SAPG}StatusUnengagedUnreached`]: 'UUPG',
}

const sourceShortName = (iri: string | null | undefined) => {
  if (!iri) return '—'
  return iri.split(/[#/]/).pop() ?? iri
}

const pct = (n: number | null) => n == null ? '—' : `${(n * 100).toFixed(1)}%`

export async function PeopleGroupFocusSection({ orgAddress }: { orgAddress: string }) {
  const data = await loadFocusData(orgAddress)
  if (!data) return null  // org doesn't sponsor any segments — render nothing

  const t2Available = data.authMode !== 'public'

  return (
    <section data-component="graph-section">
      <h2>People-Group Focus ({data.segments.length})</h2>
      <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '0.75rem' }}>
        Population segments stewarded by this organization, with per-segment
        estimates, reachedness, and (for delegated readers) communities and
        geometry. Multi-source disagreement is shown as separate estimate rows.
      </p>
      <p style={{ fontSize: '0.7rem', color: '#9a8c7e', marginBottom: '1rem' }}>
        {data.authMode === 'sponsor' && 'Auth: sponsor session — full T2 access.'}
        {data.authMode === 'delegated' && 'Auth: delegated reader (cross-delegation) — full T2 access.'}
        {data.authMode === 'public' && 'Auth: public — only T1 registrations shown. Estimates / reachedness / communities are sponsor-private.'}
      </p>

      <table data-component="graph-table" style={{ marginBottom: '1rem' }}>
        <thead>
          <tr>
            <th>Display name</th>
            <th>Scope</th>
            <th>Place</th>
            <th>Pop est.</th>
            <th>%Evang</th>
            <th>Reachedness</th>
          </tr>
        </thead>
        <tbody>
          {data.segments.map(s => {
            const ests = data.estimatesBySegment[s.id] ?? []
            const ras = data.reachednessBySegment[s.id] ?? []
            const latest = ests[0]
            const latestRa = ras[0]
            const place = s.spatialFeatureId
              ? (s.spatialFeatureId.split('#').pop() ?? s.spatialFeatureId)
              : '—'
            return (
              <tr key={s.id}>
                <td>
                  {s.parentSegmentId ? '↳ ' : ''}
                  {s.displayName ?? <span data-component="text-muted">(no name)</span>}
                  {s.visibility === 'sponsor-private' && (
                    <span style={{
                      marginLeft: 6, fontSize: '0.6rem', fontWeight: 700,
                      padding: '0.05rem 0.3rem', borderRadius: 4,
                      background: '#1f2937', color: '#fff',
                    }}>PRIVATE</span>
                  )}
                </td>
                <td><span data-component="role-badge">{SCOPE_LABELS[s.scopeTypeId] ?? s.scopeTypeId}</span></td>
                <td>{place}</td>
                <td>{t2Available ? (latest?.populationCount?.toLocaleString() ?? '—') : <Lock />}</td>
                <td>{t2Available ? pct(latest?.percentEvangelical ?? null) : <Lock />}</td>
                <td>{t2Available
                  ? (latestRa ? STATUS_LABEL[latestRa.reachednessStatusIri ?? ''] ?? '—' : '—')
                  : <Lock />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {t2Available && (
        <>
          {/* Multi-source disagreement, per segment with multiple estimates. */}
          {data.segments.map(s => {
            const ests = data.estimatesBySegment[s.id] ?? []
            if (ests.length < 2) return null
            return (
              <div key={`disagree-${s.id}`} style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.85rem', color: '#5c4a3a', marginBottom: '0.4rem' }}>
                  Sources for {s.displayName} ({ests.length})
                </h3>
                <table data-component="graph-table">
                  <thead>
                    <tr><th>Source</th><th>Pop count</th><th>%Evang</th><th>Confidence</th><th>Recorded</th></tr>
                  </thead>
                  <tbody>
                    {ests.map(e => (
                      <tr key={e.id}>
                        <td><code style={{ fontSize: '0.7rem' }}>{sourceShortName(e.sourceRecordIri)}</code></td>
                        <td>{e.populationCount?.toLocaleString() ?? '—'}</td>
                        <td>{pct(e.percentEvangelical ?? null)}</td>
                        <td>{e.confidenceScore?.toFixed(2) ?? '—'}</td>
                        <td>{e.recordedAt.split('T')[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}

          {/* Communities — Tier-2-Sensitive. */}
          {Object.entries(data.communitiesBySegment).map(([segId, list]) => {
            if (list.length === 0) return null
            const seg = data.segments.find(s => s.id === segId)
            return (
              <div key={`comm-${segId}`} style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.85rem', color: '#5c4a3a', marginBottom: '0.4rem' }}>
                  Communities — {seg?.displayName ?? segId} ({list.length})
                </h3>
                <ul style={{ fontSize: '0.85rem', paddingLeft: '1rem', color: '#3a3028' }}>
                  {list.map(c => (
                    <li key={c.id}>
                      <strong>{c.displayName}</strong>
                      {c.cohesionBasis && <> — <em style={{ color: '#5c4a3a' }}>{c.cohesionBasis}</em></>}
                      {c.locationHint && <> · {c.locationHint}</>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}

      <p style={{ fontSize: '0.7rem', color: '#9a8c7e' }}>
        <Link href="https://joshuaproject.net/" style={{ color: '#1565c0' }}>Joshua Project</Link>
        {' '}and{' '}
        <Link href="https://peoplegroups.org/" style={{ color: '#1565c0' }}>PeopleGroups.org</Link>
        {' '}are the canonical reference schemes for the Wolof concept and PGAC/PGIC vocabulary above.
      </p>
    </section>
  )
}

function Lock() {
  return <span title="Sponsor-private; requires delegation to view" style={{ color: '#9a8c7e' }}>🔒 private</span>
}
