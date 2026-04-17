import Link from 'next/link'
import { HUB_LANDING_CONFIGS } from '@/lib/hub-routes'

export default function HomePage() {
  return (
    <main
      className="min-h-screen"
      style={{
        background:
          'radial-gradient(circle at top left, rgba(123, 88, 199, 0.10), transparent 28%), radial-gradient(circle at top right, rgba(63, 110, 232, 0.12), transparent 24%), linear-gradient(180deg, #f6f7fb 0%, #eef2f8 100%)',
      }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:px-10">
        <section
          className="overflow-hidden rounded-[32px] border border-white/70 shadow-[0_24px_80px_rgba(40,52,89,0.12)]"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(247,249,253,0.98) 56%, rgba(241,244,250,0.98) 100%)',
          }}
        >
          <div className="px-8 py-10 lg:px-12 lg:py-12">
            <div className="mb-6 flex items-center gap-4">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-[22px] shadow-[0_16px_36px_rgba(74,88,128,0.18)]"
                style={{ background: 'linear-gradient(135deg, #384a7a 0%, #7b58c7 100%)' }}
              >
                <svg width="30" height="30" viewBox="0 0 48 48" fill="none">
                  <path d="M14 24L20 18L26 24L32 18L38 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 32L20 26L26 32L32 26L38 32" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
                  <circle cx="24" cy="14" r="3" fill="white" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[#667085]">Smart Agent</div>
                <div className="text-sm text-[#7b8297]">Hub access</div>
              </div>
            </div>

            <h1 className="max-w-xl text-5xl font-semibold leading-[1.02] tracking-[-0.05em] text-[#171c28] sm:text-6xl">
              Select a hub
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#5d6478]">
              Choose a hub to continue. Each hub has its own landing page, demo users, and entry flow.
            </p>
          </div>
        </section>

        <section className="mt-8">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {HUB_LANDING_CONFIGS.map((hub) => (
              <Link
                key={hub.slug}
                href={`/h/${hub.slug}`}
                className="group block overflow-hidden rounded-[28px] border no-underline shadow-[0_16px_40px_rgba(34,43,68,0.08)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_52px_rgba(34,43,68,0.14)]"
                style={{
                  background: hub.heroGradient,
                  borderColor: `${hub.color}20`,
                }}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div
                      className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]"
                      style={{ background: hub.colorSoft, color: hub.color }}
                    >
                      {hub.eyebrow}
                    </div>
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-[16px] text-sm font-bold"
                      style={{
                        background: 'rgba(255,255,255,0.7)',
                        color: hub.color,
                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55)',
                      }}
                    >
                      {hub.demoUsers.length}
                    </div>
                  </div>

                  <h3 className="mt-8 text-2xl font-semibold tracking-[-0.03em] text-[#202637] transition-colors group-hover:text-black">
                    {hub.name}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-[#5d6478]">
                    {hub.description}
                  </p>

                  <div className="mt-8 flex items-center justify-between">
                    <div className="text-sm font-medium text-[#677089]">{hub.demoUsers.length} demo users</div>
                    <div
                      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                      style={{ background: 'rgba(255,255,255,0.74)', color: hub.color }}
                    >
                      Open hub
                      <span aria-hidden="true">→</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
