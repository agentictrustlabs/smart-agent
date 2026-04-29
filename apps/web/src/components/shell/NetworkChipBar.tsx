'use client'

/**
 * `<NetworkChipBar>` — cross-network filter for surfaces that span
 * Catalyst's sister networks (Catalyst NoCo, Front Range House
 * Churches, Plains Church Planters, Denver Metro Bridge — and any
 * future siblings linked under the Catalyst Hub).
 *
 * Phase 2 ships the picker as URL-state-only: clicking a chip sets
 * `?network=<slug>` and the surface re-reads. The chip bar itself is
 * controlled, not sourced from on chain — it's the consumer page's
 * job to actually filter results by the selected network.
 *
 * The bar always includes "All sisters" as the first chip (= no
 * filter). The user's primary network can be highlighted but doesn't
 * auto-default; that's the consumer page's choice.
 */

import { useRouter, useSearchParams } from 'next/navigation'

export interface NetworkChipOption {
  slug: string
  label: string
  /** Optional org agent address (when known) — useful for downstream filters that need the actual address. */
  address?: `0x${string}`
}

/** The Catalyst hub's known sister networks. Hard-coded for v1; later
 *  versions read this from on-chain HAS_MEMBER edges off the hub agent. */
export const CATALYST_SISTER_NETWORKS: NetworkChipOption[] = [
  { slug: 'catalyst-noco', label: 'Catalyst NoCo' },
  { slug: 'front-range',   label: 'Front Range House Churches' },
  { slug: 'plains',        label: 'Plains Church Planters' },
  { slug: 'denver-metro',  label: 'Denver Metro Bridge' },
]

export function NetworkChipBar({
  options = CATALYST_SISTER_NETWORKS,
  paramName = 'network',
}: {
  options?: NetworkChipOption[]
  /** URL search param name to write the selected slug into. */
  paramName?: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const current = params.get(paramName) ?? ''   // empty = "All sisters"

  function pick(slug: string) {
    const next = new URLSearchParams(params.toString())
    if (slug === '') next.delete(paramName)
    else next.set(paramName, slug)
    const qs = next.toString()
    router.push(qs ? `?${qs}` : '?')
  }

  return (
    <div
      data-testid="network-chip-bar"
      style={{
        display: 'flex', gap: 6, flexWrap: 'wrap',
        marginBottom: '0.75rem',
      }}
    >
      <Chip label="All sisters" active={current === ''} onClick={() => pick('')} />
      {options.map(opt => (
        <Chip
          key={opt.slug}
          label={opt.label}
          active={current === opt.slug}
          onClick={() => pick(opt.slug)}
        />
      ))}
    </div>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0.25rem 0.65rem',
        borderRadius: 999,
        border: `1px solid ${active ? '#8b5e3c' : '#ece6db'}`,
        background: active ? '#fdf6ee' : '#fff',
        color: active ? '#5c4a3a' : '#64748b',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
