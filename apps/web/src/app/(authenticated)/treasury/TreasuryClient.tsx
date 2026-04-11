'use client'

import { useState } from 'react'

export function TreasuryClient({ targetAddress, targetName }: { targetAddress: string; targetName: string }) {
  const [copied, setCopied] = useState(false)

  function copyAddress() {
    navigator.clipboard.writeText(targetAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <code style={{
        background: '#f8f9fa', border: '1px solid #2a2a3e', borderRadius: 6,
        padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontFamily: 'monospace',
        color: '#1a1a2e', flex: 1, minWidth: 300,
      }}>
        {targetAddress}
      </code>
      <button onClick={copyAddress} style={{ background: '#e5e7eb', color: '#1a1a2e', padding: '0.5rem 1rem', whiteSpace: 'nowrap' }}>
        {copied ? 'Copied!' : 'Copy Address'}
      </button>
      <p style={{ width: '100%', fontSize: '0.75rem', color: '#555', marginTop: '0.25rem' }}>
        Send ETH from your wallet (MetaMask) to this address. The {targetName} smart account
        will receive and hold the funds independently from the organization.
      </p>
    </div>
  )
}
