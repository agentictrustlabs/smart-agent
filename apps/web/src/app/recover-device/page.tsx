import { RecoverDeviceClient } from './RecoverDeviceClient'

export const metadata = { title: 'Recover device · Smart Agent' }

export default function RecoverDevicePage() {
  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Recover this device</h1>
      <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
        Lost or replaced the device that held your passkey? You can register a new
        passkey on this browser. We&apos;ll record the request, wait the configured
        recovery delay (set short for the demo), then activate the new passkey
        through your account&apos;s recovery delegation.
      </p>
      <RecoverDeviceClient />
    </main>
  )
}
