import Link from 'next/link'
import { UserDropdown } from '@/components/auth/UserDropdown'
import { NotificationBell } from '@/components/notifications/NotificationBell'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-layout="authenticated">
      <header data-component="app-header">
        <Link href="/dashboard">Smart Agent</Link>
        <nav data-component="global-nav">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/relationships">Relationships</Link>
          <Link href="/templates">Templates</Link>
          <Link href="/issuers">Issuers</Link>
          <Link href="/reviews">Reviews</Link>
          <Link href="/tee">TEE</Link>
          <Link href="/graph">Graph</Link>
        </nav>
        <NotificationBell />
        <UserDropdown />
      </header>
      <main data-component="app-content">{children}</main>
    </div>
  )
}
