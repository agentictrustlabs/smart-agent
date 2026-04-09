import Link from 'next/link'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-layout="authenticated">
      <header data-component="app-header">
        <Link href="/dashboard">Smart Agent</Link>
        <nav data-component="global-nav">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/deploy/person">Deploy Person Agent</Link>
          <Link href="/deploy/org">Deploy Org Agent</Link>
          <Link href="/relationships">Relationships</Link>
          <Link href="/graph">Graph</Link>
        </nav>
      </header>
      <main data-component="app-content">{children}</main>
    </div>
  )
}
