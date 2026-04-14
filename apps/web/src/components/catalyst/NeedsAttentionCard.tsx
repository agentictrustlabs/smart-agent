import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────

export interface AttentionItem {
  type: 'circle' | 'oikos' | 'prayer'
  label: string
  detail: string
  href: string
}

// ─── Icon per type ──────────────────────────────────────────────────

const TYPE_ICONS: Record<AttentionItem['type'], string> = {
  circle: '\u{1F4CA}', // 📊
  oikos: '\u{1F4AC}',  // 💬
  prayer: '\u{1F64F}', // 🙏
}

// ─── Component ──────────────────────────────────────────────────────

export function NeedsAttentionCard({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null

  return (
    <div
      style={{
        background: 'rgba(217,119,6,0.06)',
        border: '1px solid rgba(217,119,6,0.25)',
        borderRadius: 10,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#d97706',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '0.5rem',
        }}
      >
        Needs Attention
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {items.map((item, i) => (
          <Link
            key={`${item.type}-${item.label}-${i}`}
            href={item.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 0.5rem',
              borderRadius: 8,
              background: '#fff',
              border: '1px solid rgba(217,119,6,0.15)',
              textDecoration: 'none',
              transition: 'background 0.15s ease',
            }}
          >
            <span style={{ fontSize: '1rem', flexShrink: 0 }}>
              {TYPE_ICONS[item.type]}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#292524',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: '0.72rem',
                  color: '#9a8c7e',
                  lineHeight: 1.3,
                }}
              >
                {item.detail}
              </div>
            </div>
            <span style={{ fontSize: '0.85rem', color: '#d97706', flexShrink: 0 }}>
              &rsaquo;
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
