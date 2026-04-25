'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/use-auth'
import { FRESH_LOGIN_INTENT_KEY } from '@/components/auth/AuthGate'
import type { HubLandingConfig } from '@/lib/hub-routes'

interface Props {
  config: HubLandingConfig
  allHubs: Array<{ slug: string; name: string; color: string; colorSoft?: string }>
}

export function HubLandingClient({ config, allHubs }: Props) {
  const { authenticated, ready } = useAuth()
  const [loading, setLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [connectInitiated, setConnectInitiated] = useState(false)

  useEffect(() => {
    if (ready && authenticated && connectInitiated) {
      window.location.href = `/h/${config.slug}/home`
    }
  }, [ready, authenticated, connectInitiated, config.slug])

  function handleConnectWallet() {
    if (typeof window === 'undefined') return
    setConnectInitiated(true)
    window.sessionStorage.setItem(FRESH_LOGIN_INTENT_KEY, 'true')
    // Phase 2 will route this to /sign-in (passkey + SIWE). For now, just
    // surface the demo picker which is on the same page.
    window.location.href = '/sign-in'
  }

  async function handleSelectUser(key: string) {
    setLoading(true)
    setSelectedUser(key)

    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})

    const loginRes = await fetch('/api/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: key }),
    })

    if (!loginRes.ok) {
      setLoading(false)
      setSelectedUser(null)
      return
    }

    fetch('/api/a2a/bootstrap', { method: 'POST' }).catch(() => {})
    window.location.href = `/h/${config.slug}/home`
  }

  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(circle at top right, ${config.color}18 0%, transparent 24%), ${config.heroGradient}`,
      }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 lg:px-10">
        <nav
          className="flex flex-wrap items-center gap-2 rounded-[26px] border px-4 py-3 shadow-[0_10px_32px_rgba(30,41,66,0.06)]"
          style={{
            background: 'rgba(255,255,255,0.72)',
            borderColor: `${config.color}20`,
            backdropFilter: 'blur(10px)',
          }}
        >
          <Link href="/" className="mr-2 text-sm font-semibold text-[#394154] no-underline transition-colors hover:text-black">
            Smart Agent
          </Link>
          {allHubs.map((h) => (
            <Link
              key={h.slug}
              href={`/h/${h.slug}`}
              className="rounded-full px-4 py-2 text-sm font-semibold no-underline transition-all"
              style={{
                background: h.slug === config.slug ? config.colorSoft : 'rgba(255,255,255,0.6)',
                color: h.slug === config.slug ? config.color : '#5f677d',
                boxShadow: h.slug === config.slug ? `inset 0 0 0 1px ${config.color}22` : 'inset 0 0 0 1px rgba(149, 157, 178, 0.18)',
              }}
            >
              {h.name}
            </Link>
          ))}
        </nav>

        <section className="grid flex-1 gap-6 pt-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div
            className="overflow-hidden rounded-[32px] border shadow-[0_24px_70px_rgba(37,44,71,0.10)]"
            style={{
              background: 'linear-gradient(160deg, rgba(255,255,255,0.96) 0%, rgba(248,249,252,0.96) 60%, rgba(244,246,251,0.98) 100%)',
              borderColor: `${config.color}18`,
            }}
          >
            <div className="grid gap-8 px-8 py-8 lg:grid-cols-[1fr_0.9fr] lg:px-10 lg:py-10">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: config.color }}>
                  {config.name}
                </div>

                <h1 className="mt-5 max-w-xl text-5xl font-semibold leading-[1.02] tracking-[-0.05em] text-[#171c28]">
                  {config.slug === 'catalyst' ? 'Catalyst hub' : config.name}
                </h1>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-[#5e667c]">
                  {config.description}
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <button
                    onClick={handleConnectWallet}
                    disabled={!true /* native auth always available */}
                    className="rounded-full px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(46,55,88,0.18)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: true /* native auth always available */
                        ? `linear-gradient(135deg, ${config.color} 0%, #384a7a 100%)`
                        : '#a6adbf',
                    }}
                  >
                    {true /* native auth always available */ ? 'Connect Wallet' : 'Wallet Not Configured'}
                  </button>
                  <div className="text-sm text-[#6a7288]">or select a demo user</div>
                </div>
              </div>

              <div
                className="rounded-[28px] border p-6"
                style={{
                  background: `linear-gradient(160deg, ${config.color} 0%, #37476f 100%)`,
                  borderColor: 'rgba(255,255,255,0.14)',
                }}
              >
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white/72">Hub details</div>
                <div className="mt-6 grid gap-4">
                  <div className="rounded-[22px] bg-white/12 p-4 backdrop-blur-[8px]">
                    <div className="text-sm font-medium text-white/70">Hub</div>
                    <div className="mt-1 text-lg font-semibold text-white">{config.name}</div>
                  </div>
                  <div className="rounded-[22px] bg-white/12 p-4 backdrop-blur-[8px]">
                    <div className="text-sm font-medium text-white/70">Route</div>
                    <div className="mt-1 text-lg font-semibold text-white">/h/{config.slug}</div>
                  </div>
                  <div className="rounded-[22px] bg-white/12 p-4 backdrop-blur-[8px]">
                    <div className="text-sm font-medium text-white/70">Demo users</div>
                    <div className="mt-1 text-lg font-semibold text-white">{config.demoUsers.length}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="rounded-[32px] border p-6 shadow-[0_24px_70px_rgba(37,44,71,0.08)]"
            style={{
              background: 'rgba(255,255,255,0.88)',
              borderColor: `${config.color}18`,
            }}
          >
            <div className="flex items-start justify-between gap-4 text-left">
              <div className="min-w-0">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#6c7388]">Demo users</div>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[#1e2433]">
                  Choose a user
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#6a7288]">
                  Select a demo user to enter this hub.
                </p>
              </div>
              <div
                className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold"
                style={{ background: config.colorSoft, color: config.color }}
              >
                {config.demoUsers.length}
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {config.demoUsers.map((u) => (
                <button
                  key={u.key}
                  onClick={() => handleSelectUser(u.key)}
                  disabled={loading}
                  className="flex w-full flex-col items-start rounded-[24px] border p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(37,44,71,0.10)] disabled:cursor-wait disabled:opacity-60"
                  style={{
                    background: selectedUser === u.key ? config.surfaceTint : '#ffffff',
                    borderColor: selectedUser === u.key ? `${config.color}40` : 'rgba(149, 157, 178, 0.2)',
                  }}
                >
                  <div className="flex w-full items-center gap-4 text-left">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-[16px] text-sm font-bold"
                      style={{ background: config.colorSoft, color: config.color }}
                    >
                      {u.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold text-[#202637]">{u.name}</div>
                      <div className="truncate text-sm text-[#6a7288]">{u.role}</div>
                    </div>
                  </div>

                  <div className="mt-3 w-full text-sm text-[#6a7288]">{u.org}</div>

                  {loading && selectedUser === u.key && (
                    <div className="mt-3 w-full text-sm font-semibold animate-pulse" style={{ color: config.color }}>
                      Connecting...
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
