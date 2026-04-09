import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { AuthGate } from '@/components/auth/AuthGate'

export default function HomePage() {
  return (
    <main data-page="home">
      <AuthGate />
      <div data-component="hero">
        <h1>Smart Agent</h1>
        <p>Deploy ERC-4337 agent smart accounts with programmable delegation</p>
        <p>Person agents, Organization agents, programmable delegation</p>
        <ConnectWalletButton />
      </div>
    </main>
  )
}
