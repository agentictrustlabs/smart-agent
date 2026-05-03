import { db, schema } from '@/db'
import { and, eq, inArray } from 'drizzle-orm'
import { NeedsAttentionCard, type AttentionItem } from './NeedsAttentionCard'

interface Props {
  userId: string
  userOrgs: Array<{ address: string; name: string; roles: string[] }>
  hubSlug: string
}

/**
 * `<CatalystAttentionStrip>` — self-fetching attention-items computer.
 *
 * Extracted from the parent dashboard so it can sit behind a Suspense
 * boundary. The parent renders the hero + KPIs immediately; this strip
 * streams in once `listMyRelationshipsAction` resolves (the slowest of
 * the three queries it runs).
 *
 * Returns nothing when there are no items.
 */
export async function CatalystAttentionStrip({ userId, userOrgs, hubSlug }: Props) {
  const attentionItems: AttentionItem[] = []

  // 1. Stale circles — orgs with zero activity in 14 days.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  const orgAddrs = userOrgs.map(o => o.address.toLowerCase())
  if (orgAddrs.length > 0) {
    let recentRows: any[] = []
    try { recentRows = await db.select({
      org: schema.activityLogs.orgAddress,
      d: schema.activityLogs.activityDate,
    }).from(schema.activityLogs)
      .where(inArray(schema.activityLogs.orgAddress, orgAddrs))
      .all() } catch { /* activityLogs table dropped */ }
    const orgsWithRecent = new Set<string>()
    for (const r of recentRows) {
      if (r.d >= fourteenDaysAgo) orgsWithRecent.add(r.org.toLowerCase())
    }

    // De-dupe with Open Needs: needs moved to person-mcp / org-mcp; the
    // stale-circle detail line is best-effort for now and falls back to
    // the generic "no activity" message when the lookup is unavailable.
    const orgOpenNeed = new Map<string, { id: string; title: string }>()
    try {
      let openNeedsOnMyOrgs: any[] = []
      try { openNeedsOnMyOrgs = db.select().from(schema.needs)
        .where(and(
          inArray(schema.needs.neededByAgent, orgAddrs),
          eq(schema.needs.status, 'open'),
        ))
        .all() } catch { /* needs table dropped */ }
      for (const n of openNeedsOnMyOrgs) {
        if (!orgOpenNeed.has(n.neededByAgent)) {
          orgOpenNeed.set(n.neededByAgent, { id: n.id, title: n.title })
        }
      }
    } catch { /* needs table dropped */ }

    for (const org of userOrgs) {
      if (orgsWithRecent.has(org.address.toLowerCase())) continue
      const matchingNeed = orgOpenNeed.get(org.address.toLowerCase())
      if (matchingNeed) {
        attentionItems.push({
          type: 'group',
          label: org.name,
          detail: `Stale — open need posted: ${matchingNeed.title}`,
          href: `/h/${hubSlug}/needs/${matchingNeed.id}`,
        })
      } else {
        attentionItems.push({
          type: 'group',
          label: org.name,
          detail: 'No activity in 14 days',
          href: `/agents/${org.address}`,
        })
      }
    }
  }

  // 2. Stale prayers — pulled from person-mcp via the rewired action.
  try {
    const { getPrayers } = await import('@/lib/actions/prayer.action')
    const allPrayers = await getPrayers(userId).catch(() => [])
    const sevenDaysAgo = Date.now() - 7 * 86_400_000
    const overduePrayers = allPrayers.filter(p => {
      if (p.responseState === 'answered') return false
      if (!p.lastPrayedAt) return false
      return new Date(p.lastPrayedAt).getTime() < sevenDaysAgo
    })
    if (overduePrayers.length > 0) {
      attentionItems.push({
        type: 'prayer',
        label: `${overduePrayers.length} stale prayer${overduePrayers.length === 1 ? '' : 's'}`,
        detail: 'Not prayed in over a week',
        href: '/nurture/prayer',
      })
    }
  } catch { /* no A2A session yet */ }

  // 3. Pending on-chain relationship requests targeted at the user. This is
  // the slowest of the three (chain RPC) — the whole point of the Suspense
  // boundary is to let the rest of the page render before this resolves.
  let pendingIncoming = 0
  try {
    const { listMyRelationshipsAction } = await import('@/lib/actions/list-my-relationships.action')
    const rels = await listMyRelationshipsAction()
    pendingIncoming = rels.filter(r => r.status === 1 && r.direction === 'incoming').length
  } catch { /* relationships layer unavailable */ }
  if (pendingIncoming > 0) {
    attentionItems.push({
      type: 'governance',
      label: `${pendingIncoming} pending request${pendingIncoming === 1 ? '' : 's'}`,
      detail: 'Awaiting your confirmation',
      href: '/relationships',
    })
  }

  return (
    <NeedsAttentionCard
      items={attentionItems.slice(0, 5)}
      title="On your plate"
      subtitle="Things only you can resolve — your circles, prayers, and pending requests"
    />
  )
}

/** Skeleton matched to the rendered card so there's no layout shift. */
export function CatalystAttentionStripSkeleton() {
  return (
    <div
      style={{
        background: 'rgba(217,119,6,0.04)',
        border: '1px solid rgba(217,119,6,0.10)',
        borderRadius: 10,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        height: 64,
      }}
      aria-hidden
    />
  )
}
