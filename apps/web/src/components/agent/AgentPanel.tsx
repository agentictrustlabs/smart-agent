'use client'

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Props {
  open: boolean
  onClose: () => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
}

// ---------------------------------------------------------------------------
// Context-aware agent resolver
// ---------------------------------------------------------------------------
function getContextAgent(pathname: string): { name: string; type: string; color: string } {
  if (pathname.includes('/groups/'))
    return { name: 'Circle Agent', type: 'Organization', color: '#2e7d32' }
  if (pathname.includes('/circles') || pathname.includes('/nurture'))
    return { name: 'Personal Agent', type: 'Assistant', color: '#8b5e3c' }
  if (pathname.includes('/steward') || pathname.includes('/treasury'))
    return { name: 'Finance Agent', type: 'AI', color: '#7c3aed' }
  if (pathname.includes('/activity'))
    return { name: 'Activity Tracker', type: 'AI', color: '#7c3aed' }
  return { name: 'Your Agent', type: 'Assistant', color: '#8b5e3c' }
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const P = {
  bg: '#ffffff',
  cardBg: '#faf8f3',
  text: '#5c4a3a',
  textMuted: '#9a8b7a',
  border: '#ece6db',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.08)',
}

// ---------------------------------------------------------------------------
// Hardcoded suggestions (placeholder)
// ---------------------------------------------------------------------------
const SUGGESTIONS = [
  {
    id: 's1',
    text: "You haven't prayed for 2 contacts this week. Would you like me to set up reminders?",
  },
  {
    id: 's2',
    text: "Grace Community's youth ministry hasn't reported health metrics in 3 weeks.",
  },
  {
    id: 's3',
    text: 'Based on your activity pattern, consider scheduling a follow-up with the Wellington circle.',
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AgentPanel({ open, onClose }: Props) {
  const pathname = usePathname()
  const agent = getContextAgent(pathname)

  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set())
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  function handleDismiss(id: string) {
    setDismissedSuggestions(prev => new Set(prev).add(id))
  }

  function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = inputValue.trim()
    if (!text) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
    }
    const agentMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'agent',
      text: "I'm getting connected to my A2A backend. Full agent intelligence coming soon!",
    }
    setChatMessages(prev => [...prev, userMsg, agentMsg])
    setInputValue('')
  }

  const visibleSuggestions = SUGGESTIONS.filter(s => !dismissedSuggestions.has(s.id))

  return (
    <>
      {/* Backdrop for mobile — click to close */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 49,
            background: 'rgba(0,0,0,0.15)',
          }}
        />
      )}

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          background: P.bg,
          borderLeft: `1px solid ${P.border}`,
          boxShadow: open ? '-4px 0 24px rgba(0,0,0,0.08)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          opacity: open ? 1 : 0,
          transition: 'transform 200ms ease, opacity 200ms ease',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.75rem 1rem',
            borderBottom: `1px solid ${P.border}`,
            flexShrink: 0,
          }}
        >
          {/* Avatar */}
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: agent.color,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.85rem',
              flexShrink: 0,
            }}
          >
            {agent.name.charAt(0)}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 650,
                fontSize: '0.9rem',
                color: P.text,
                lineHeight: 1.25,
              }}
            >
              {agent.name}
            </div>
            <span
              style={{
                fontSize: '0.65rem',
                fontWeight: 600,
                color: agent.color,
                background: `${agent.color}15`,
                padding: '1px 6px',
                borderRadius: 8,
              }}
            >
              {agent.type}
            </span>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close agent panel"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '0.25rem',
              borderRadius: 6,
              color: P.textMuted,
              fontSize: '1.1rem',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &#x2715;
          </button>
        </div>

        {/* ── Scrollable middle: Suggestions + Chat ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {/* Suggestions section */}
          {visibleSuggestions.length > 0 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <div
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: P.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.4rem',
                }}
              >
                Suggestions
              </div>
              {visibleSuggestions.map(s => (
                <div
                  key={s.id}
                  style={{
                    border: `1px solid ${P.border}`,
                    borderRadius: 10,
                    padding: '0.65rem 0.75rem',
                    marginBottom: '0.4rem',
                    background: P.cardBg,
                    position: 'relative',
                  }}
                >
                  <p
                    style={{
                      fontSize: '0.8rem',
                      color: P.text,
                      margin: 0,
                      lineHeight: 1.45,
                      paddingRight: '1rem',
                    }}
                  >
                    {s.text}
                  </p>

                  {/* Dismiss X */}
                  <button
                    onClick={() => handleDismiss(s.id)}
                    aria-label="Dismiss suggestion"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: P.textMuted,
                      fontSize: '0.75rem',
                      lineHeight: 1,
                      padding: 2,
                    }}
                  >
                    &#x2715;
                  </button>

                  {/* Action buttons */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.35rem',
                      marginTop: '0.45rem',
                    }}
                  >
                    {['View', 'Dismiss', 'Ask More'].map(label => (
                      <button
                        key={label}
                        onClick={label === 'Dismiss' ? () => handleDismiss(s.id) : undefined}
                        style={{
                          border: `1px solid ${P.border}`,
                          borderRadius: 14,
                          padding: '0.2rem 0.55rem',
                          fontSize: '0.7rem',
                          fontWeight: 550,
                          color: P.accent,
                          background: P.bg,
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Chat messages */}
          {chatMessages.map(msg => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '0.5rem 0.7rem',
                borderRadius: 10,
                fontSize: '0.8rem',
                lineHeight: 1.45,
                color: msg.role === 'user' ? '#fff' : P.text,
                background: msg.role === 'user' ? P.accent : P.cardBg,
                border: msg.role === 'agent' ? `1px solid ${P.border}` : 'none',
              }}
            >
              {msg.text}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* ── Chat input (fixed at bottom) ── */}
        <form
          onSubmit={handleSend}
          style={{
            display: 'flex',
            gap: '0.4rem',
            padding: '0.6rem 0.75rem',
            borderTop: `1px solid ${P.border}`,
            background: P.bg,
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Ask your agent..."
            style={{
              flex: 1,
              border: `1px solid ${P.border}`,
              borderRadius: 8,
              padding: '0.45rem 0.65rem',
              fontSize: '0.82rem',
              color: P.text,
              background: P.cardBg,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '0.45rem 0.75rem',
              fontSize: '0.82rem',
              fontWeight: 650,
              color: '#fff',
              background: P.accent,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Send
          </button>
        </form>
      </div>
    </>
  )
}
