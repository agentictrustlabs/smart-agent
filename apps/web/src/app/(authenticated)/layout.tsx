import Link from 'next/link'
import { UserDropdown } from '@/components/auth/UserDropdown'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { GlobalNav } from '@/components/nav/GlobalNav'
import { OrgContextProvider } from '@/components/org/OrgContext'
import { OrgSelector } from '@/components/org/OrgSelector'
import { DemoUserBadge } from '@/components/auth/DemoUserBadge'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgContextProvider>
      <div data-layout="authenticated">
        <header data-component="app-header">
          <Link href="/dashboard">Smart Agent</Link>
          <OrgSelector />
          <GlobalNav />
          <NotificationBell />
          {SKIP_AUTH ? <DemoUserBadge /> : <UserDropdown />}
        </header>
        <main data-component="app-content">{children}</main>
      </div>
    </OrgContextProvider>
  )
}
