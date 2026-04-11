import Link from 'next/link'

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-layout="setup">
      <header data-component="setup-header">
        <Link href="/dashboard" style={{ fontSize: '1.2rem', fontWeight: 600, color: '#1a1a2e', letterSpacing: '-0.02em' }}>
          Smart Agent
        </Link>
      </header>
      <main data-component="setup-content">
        {children}
      </main>
    </div>
  )
}
