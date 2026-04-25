'use client'

import { AuthGate } from '@/components/auth/AuthGate'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthGate />
      {children}
    </>
  )
}
