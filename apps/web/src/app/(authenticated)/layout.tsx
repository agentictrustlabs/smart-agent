export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { UserDropdown } from '@/components/auth/UserDropdown'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { HubNav } from '@/components/nav/HubNav'
import { OrgContextProvider } from '@/components/org/OrgContext'
import { ContextSelector } from '@/components/org/ContextSelector'
import { DemoUserBadge } from '@/components/auth/DemoUserBadge'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgContextProvider>
      <div data-layout="authenticated">
        <header data-component="app-header">
          <div data-component="header-primary">
            <Link href="/dashboard" data-component="header-logo">
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
                <rect width="48" height="48" rx="12" fill="#1565c0" />
                <path d="M14 24L20 18L26 24L32 18L38 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 32L20 26L26 32L32 26L38 32" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                <circle cx="24" cy="14" r="3" fill="white" />
              </svg>
              Smart Agent
            </Link>
            <div data-component="header-divider" />
            <ContextSelector />
            <HubNav />
          </div>
          <div data-component="header-utility">
            <NotificationBell />
            {SKIP_AUTH ? <DemoUserBadge /> : <UserDropdown />}
          </div>
        </header>
        <main data-component="app-content">{children}</main>
      </div>
    </OrgContextProvider>
  )
}
