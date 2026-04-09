import type { Metadata } from 'next'
import { Providers } from './providers'
import { WalletEventListener } from '@/components/auth/WalletEventListener'
import './globals.css'

export const metadata: Metadata = {
  title: 'Smart Agent — Agent Smart Account Kit',
  description: 'Deploy and manage ERC-4337 agent smart accounts with delegation',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <WalletEventListener />
          {children}
        </Providers>
      </body>
    </html>
  )
}
