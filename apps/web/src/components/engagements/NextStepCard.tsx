/**
 * NextStepCard — the primary call-to-action at the top of an engagement page.
 *
 * One sentence, one button, in plain language. Behind the scenes it derives
 * from the engagement's resource type + role + phase + signals (see
 * `next-step.ts`), but the user just sees: "Schedule your first session with
 * Sofia → [Log first session]".
 *
 * The 8-stop PhaseRibbon and bookkeeping artifacts (capacity, thread, etc.)
 * sit below as supporting context for users who want them.
 */

import type { NextStep } from './next-step'

const TONE = {
  action:      { bg: '#fdf6ed', border: '#e9b87a', icon: '#8b5e3c', cta: '#8b5e3c', ctaFg: '#ffffff' },
  waiting:     { bg: '#f5f3ff', border: '#c4b5fd', icon: '#6d28d9', cta: '#ffffff', ctaFg: '#6d28d9' },
  celebration: { bg: '#ecfdf5', border: '#a7f3d0', icon: '#065f46', cta: '#065f46', ctaFg: '#ffffff' },
  caution:     { bg: '#fef2f2', border: '#fecaca', icon: '#991b1b', cta: '#991b1b', ctaFg: '#ffffff' },
} as const

const TONE_ICON = {
  action: '👉',
  waiting: '⏳',
  celebration: '✨',
  caution: '⚠️',
} as const

export function NextStepCard({
  step,
  onCta,
}: {
  step: NextStep
  /** Optional CTA handler. If omitted, the card renders an anchor jump. */
  onCta?: () => void
}) {
  const tone = TONE[step.tone]
  const icon = TONE_ICON[step.tone]
  const showCta = step.ctaLabel !== null

  const ctaHref = step.ctaAnchor ? `#${step.ctaAnchor}` : undefined

  return (
    <section style={{
      background: tone.bg,
      border: `1px solid ${tone.border}`,
      borderRadius: 14,
      padding: '1.1rem 1.25rem',
      marginBottom: '1rem',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.85rem',
    }}>
      <div style={{
        fontSize: '1.6rem',
        lineHeight: 1,
        color: tone.icon,
        flexShrink: 0,
        marginTop: '0.1rem',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{
          margin: 0,
          fontSize: '1.1rem',
          fontWeight: 700,
          color: '#5c4a3a',
          lineHeight: 1.3,
        }}>
          {step.headline}
        </h2>
        {step.subline && (
          <p style={{
            margin: '0.4rem 0 0',
            fontSize: '0.85rem',
            color: '#6b5b4a',
            lineHeight: 1.5,
          }}>
            {step.subline}
          </p>
        )}
        {showCta && (
          <div style={{ marginTop: '0.85rem' }}>
            {onCta ? (
              <button
                type="button"
                onClick={onCta}
                style={{
                  padding: '0.55rem 1.1rem',
                  background: tone.cta,
                  color: tone.ctaFg,
                  border: tone.cta === '#ffffff' ? `1px solid ${tone.icon}` : 'none',
                  borderRadius: 8,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {step.ctaLabel}
              </button>
            ) : (
              <a
                href={ctaHref}
                style={{
                  display: 'inline-block',
                  padding: '0.55rem 1.1rem',
                  background: tone.cta,
                  color: tone.ctaFg,
                  border: tone.cta === '#ffffff' ? `1px solid ${tone.icon}` : 'none',
                  borderRadius: 8,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                {step.ctaLabel}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
