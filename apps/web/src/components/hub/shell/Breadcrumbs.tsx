'use client'

/**
 * Breadcrumbs — orientation bar shown when the user is two or more levels
 * deep. Uses a semantic <nav> with aria-label="Breadcrumb". Separator
 * chevrons are aria-hidden so screen readers read only the link labels.
 *
 * The component is purely presentational — the parent (HubLayoutInner)
 * derives breadcrumb data from the pathname and passes it in.
 */

import Link from 'next/link'

export interface BreadcrumbItem {
  label: string
  href: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  /** Hub border color token */
  borderColor: string
  /** Hub background token */
  bg: string
  /** Hub muted text token */
  textMuted: string
  /** Hub primary text token */
  text: string
}

export function Breadcrumbs({ items, borderColor, bg, textMuted, text }: BreadcrumbsProps) {
  if (items.length < 2) return null

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0 1.25rem',
        height: 32,
        borderTop: `1px solid ${borderColor}`,
        background: bg,
        fontSize: '0.75rem',
        color: textMuted,
      }}
    >
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {items.map((crumb, i) => {
          const isLast = i === items.length - 1
          return (
            <li
              key={crumb.href}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              {i > 0 && (
                <span aria-hidden="true" style={{ color: textMuted, opacity: 0.5, fontSize: '0.65rem' }}>
                  {'>'}
                </span>
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  style={{ color: text, fontWeight: 600 }}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  style={{
                    color: textMuted,
                    textDecoration: 'none',
                    fontWeight: 500,
                    transition: 'color 0.15s',
                  }}
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
