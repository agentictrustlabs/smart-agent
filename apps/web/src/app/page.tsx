import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { AuthGate } from '@/components/auth/AuthGate'
import { DemoLoginPicker } from '@/components/auth/DemoLoginPicker'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

export default function HomePage() {
  return (
    <main data-page="home">
      <AuthGate />
      <div data-component="hero">
        <h1>Smart Agent</h1>
        <p>Intelligent organization management with AI-powered agents, delegated authority, and verifiable trust</p>
        {!SKIP_AUTH && <ConnectWalletButton />}
        {SKIP_AUTH && <DemoLoginPicker />}
      </div>
    </main>
  )
}
