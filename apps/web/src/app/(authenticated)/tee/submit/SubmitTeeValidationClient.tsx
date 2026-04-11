'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordTeeValidation } from '@/lib/actions/record-tee-validation.action'

const TEE_ARCHITECTURES = [
  { value: 'aws-nitro', label: 'AWS Nitro Enclave', description: 'PCR0-PCR2 measurements' },
  { value: 'intel-tdx', label: 'Intel TDX', description: 'RTMR0-RTMR3 measurements' },
  { value: 'intel-sgx', label: 'Intel SGX', description: 'mrEnclave + mrSigner' },
  { value: 'amd-sev', label: 'AMD SEV-SNP', description: 'Launch measurement' },
]

const VALIDATION_METHODS = [
  { value: 'tee-onchain-verified', label: 'On-Chain Verified', description: 'TEE quote verified by on-chain smart contract (e.g., Automata DCAP, Base Nitro Validator)' },
  { value: 'tee-offchain-aggregated', label: 'Off-Chain Aggregated', description: 'TEE quote verified off-chain by a trusted TEE oracle, signature posted on-chain' },
  { value: 'reproducible-build', label: 'Reproducible Build', description: 'Deterministic build verified — source code compiles to the same code measurement' },
]

interface Agent { address: string; name: string }

export function SubmitTeeValidationClient({ agents }: { agents: Agent[] }) {
  const router = useRouter()
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.address ?? '')
  const [teeArch, setTeeArch] = useState('aws-nitro')
  const [validationMethod, setValidationMethod] = useState('tee-onchain-verified')
  const [codeMeasurement, setCodeMeasurement] = useState('')
  const [verifierContract, setVerifierContract] = useState('')
  const [evidenceURI, setEvidenceURI] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAgent) return

    setSubmitting(true)
    setError('')

    const result = await recordTeeValidation({
      agentAddress: selectedAgent,
      teeArch,
      validationMethod,
      codeMeasurement,
      verifierContract,
      evidenceURI,
    })

    setSubmitting(false)

    if (result.success) {
      setSuccess(true)
      setTimeout(() => router.push('/tee'), 2000)
    } else {
      setError(result.error ?? 'Failed to record validation')
    }
  }

  if (success) {
    return (
      <div data-component="deploy-success">
        <h2>TEE Validation Recorded</h2>
        <p>The attestation has been recorded on-chain. Redirecting...</p>
      </div>
    )
  }

  const selectedArchInfo = TEE_ARCHITECTURES.find((a) => a.value === teeArch)
  const selectedMethodInfo = VALIDATION_METHODS.find((m) => m.value === validationMethod)

  return (
    <form onSubmit={handleSubmit} data-component="deploy-form">
      {/* Agent */}
      <div data-component="form-field">
        <label htmlFor="agent">Agent to Validate</label>
        <select id="agent" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} data-component="org-select">
          {agents.map((a) => (
            <option key={a.address} value={a.address}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* TEE Architecture */}
      <div data-component="form-field">
        <label htmlFor="teeArch">TEE Architecture</label>
        <select id="teeArch" value={teeArch} onChange={(e) => setTeeArch(e.target.value)} data-component="org-select">
          {TEE_ARCHITECTURES.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
        {selectedArchInfo && (
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
            {selectedArchInfo.description}
          </p>
        )}
      </div>

      {/* Validation Method */}
      <div data-component="form-field">
        <label htmlFor="method">Validation Method</label>
        <select id="method" value={validationMethod} onChange={(e) => setValidationMethod(e.target.value)} data-component="org-select">
          {VALIDATION_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {selectedMethodInfo && (
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
            {selectedMethodInfo.description}
          </p>
        )}
      </div>

      {/* Code Measurement */}
      <div data-component="form-field">
        <label htmlFor="measurement">Code Measurement (bytes32)</label>
        <input
          id="measurement"
          type="text"
          value={codeMeasurement}
          onChange={(e) => setCodeMeasurement(e.target.value)}
          placeholder="0xe770a284d05888028565daccbfe93d59a5433a2bbb4b683aa8f6bf6c93100545"
          style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
        />
        <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
          {teeArch === 'aws-nitro' && 'keccak256(PCR0 || PCR1 || PCR2) — hash of enclave image, kernel, and application measurements'}
          {teeArch === 'intel-tdx' && 'keccak256(MRTD || RTMR0 || RTMR1 || RTMR2 || RTMR3) — hash of TD and runtime measurements'}
          {teeArch === 'intel-sgx' && 'keccak256(mrEnclave || mrSigner) — hash of enclave identity'}
          {teeArch === 'amd-sev' && 'Launch measurement hash from the SEV-SNP attestation report'}
        </p>
      </div>

      {/* Verifier Contract */}
      <div data-component="form-field">
        <label htmlFor="verifier">Verifier Contract (optional)</label>
        <input
          id="verifier"
          type="text"
          value={verifierContract}
          onChange={(e) => setVerifierContract(e.target.value)}
          placeholder="0x0000000000000000000000000000000000000000"
          style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
        />
        <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
          Address of the on-chain verifier (e.g., Automata DCAP, Base Nitro Validator). Leave empty for off-chain verification.
        </p>
      </div>

      {/* Evidence URI */}
      <div data-component="form-field">
        <label htmlFor="evidence">Evidence URI</label>
        <input
          id="evidence"
          type="text"
          value={evidenceURI}
          onChange={(e) => setEvidenceURI(e.target.value)}
          placeholder="ipfs://... or https://..."
        />
        <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
          Link to the full attestation bundle (raw quote, build provenance, signed build artifacts)
        </p>
      </div>

      {error && <p role="alert" data-component="error-message">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Recording attestation on-chain...' : 'Record TEE Validation'}
      </button>
    </form>
  )
}
