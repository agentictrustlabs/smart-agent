'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'

interface Message {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: number
  createdAt: string
}

export function NotificationBell() {
  const { authenticated } = useAuth()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authenticated) return
    const fetchMessages = () => {
      fetch('/api/messages').then((r) => r.json()).then((d) => {
        setMessages(d.messages ?? [])
        setUnread(d.unread ?? 0)
      }).catch(() => {})
    }
    fetchMessages()
    const interval = setInterval(fetchMessages, 10000)
    return () => clearInterval(interval)
  }, [authenticated])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleClick(msg: Message) {
    if (msg.read === 0) {
      await fetch(`/api/messages/${msg.id}`, { method: 'PUT' })
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, read: 1 } : m))
      setUnread((prev) => Math.max(0, prev - 1))
    }
    if (msg.link) {
      setOpen(false)
      router.push(msg.link)
    }
  }

  if (!authenticated) return null

  return (
    <div ref={ref} data-component="notification-bell">
      <button onClick={() => setOpen(!open)} data-component="bell-trigger" aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span data-component="bell-badge">{unread}</span>}
      </button>

      {open && (
        <div data-component="notification-dropdown">
          <div data-component="notification-header">
            <strong>Notifications</strong>
            {unread > 0 && <span>{unread} unread</span>}
          </div>
          {messages.length === 0 ? (
            <p data-component="notification-empty">No notifications</p>
          ) : (
            <div data-component="notification-list">
              {messages.slice(0, 10).map((msg) => (
                <div
                  key={msg.id}
                  data-component="notification-item"
                  data-read={msg.read ? 'true' : 'false'}
                  onClick={() => handleClick(msg)}
                >
                  <strong>{msg.title}</strong>
                  <p>{msg.body}</p>
                  <span data-component="notification-time">
                    {new Date(msg.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
