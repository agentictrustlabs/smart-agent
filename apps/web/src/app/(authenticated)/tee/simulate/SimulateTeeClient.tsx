'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { simulateTeeAttestation } from '@/lib/actions/simulate-tee.action'

// Pre-populated from examples/discovery-agent/
const EXAMPLE_DOCKERFILE = `# Discovery Agent — Nitro Enclave Image
FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \\
    ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py /app/agent.py

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s \\
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

CMD ["python", "/app/agent.py"]`

const EXAMPLE_CONFIG = `name: discovery-agent
version: 1.2.0
type: discovery

identity:
  chain_id: 31337
  did: "did:ethr:31337:\${AGENT_ADDRESS}"

evaluation:
  model: gpt-4
  min_trust_score: 50
  evaluation_interval: 300
  dimensions:
    - accuracy
    - reliability
    - responsiveness
    - safety
    - transparency

a2a:
  port: 8080
  version: "1.0"
  capabilities:
    - evaluate-trust
    - submit-review
    - discover-agents

tee:
  architecture: aws-nitro
  key_management:
    type: enclave-sealed

supported_trust:
  - reputation
  - tee-attestation`

const TEE_ARCHITECTURES = [
  { value: 'aws-nitro', label: 'AWS Nitro Enclave' },
  { value: 'intel-tdx', label: 'Intel TDX' },
  { value: 'intel-sgx', label: 'Intel SGX' },
  { value: 'amd-sev', label: 'AMD SEV-SNP' },
]

interface Agent { address: string; name: string }

export function SimulateTeeClient({ agents, verifierAddress }: { agents: Agent[]; verifierAddress: string }) {
  const router = useRouter()
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.address ?? '')
  const [teeArch, setTeeArch] = useState('aws-nitro')
  const [sourceCode, setSourceCode] = useState(EXAMPLE_DOCKERFILE)
  const [appConfig, setAppConfig] = useState(EXAMPLE_CONFIG)
  const [kernelVersion, setKernelVersion] = useState('linux-6.1-nitro-enclave')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    pcr0: string; pcr1: string; pcr2: string
    codeMeasurement: string; validationId: number; txHash: string
    evidenceURI: string
  } | null>(null)

  async function handleSimulate(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAgent) return

    setSubmitting(true)
    setError('')
    setResult(null)

    const res = await simulateTeeAttestation({
      agentAddress: selectedAgent,
      teeArch,
      sourceCode,
      appConfig,
      kernelVersion,
    })

    setSubmitting(false)

    if (res.success && res.data) {
      setResult(res.data)
    } else {
      setError(res.error ?? 'Simulation failed')
    }
  }

  return (
    <div>
      <form onSubmit={handleSimulate} data-component="deploy-form">
        {/* Agent */}
        <div data-component="form-field">
          <label htmlFor="agent">Agent to Attest</label>
          <select id="agent" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} data-component="org-select">
            {agents.map((a) => (
              <option key={a.address} value={a.address}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* TEE Architecture */}
        <div data-component="form-field">
          <label htmlFor="arch">TEE Architecture</label>
          <select id="arch" value={teeArch} onChange={(e) => setTeeArch(e.target.value)} data-component="org-select">
            {TEE_ARCHITECTURES.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>

        {/* Source Code / Dockerfile */}
        <div data-component="form-field">
          <label htmlFor="source">
            {teeArch === 'aws-nitro' ? 'Enclave Image (Dockerfile / EIF config)' : 'Application Code / Config'}
            {' '}<span style={{ fontSize: '0.75rem', color: '#616161' }}>
              {teeArch === 'aws-nitro' ? '→ becomes PCR0 (enclave image)' : '→ becomes measurement 0'}
            </span>
          </label>
          <textarea
            id="source" value={sourceCode} onChange={(e) => setSourceCode(e.target.value)}
            rows={5} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
        </div>

        {/* Kernel / Bootstrap */}
        <div data-component="form-field">
          <label htmlFor="kernel">
            {teeArch === 'aws-nitro' ? 'Kernel + Bootstrap' : 'Runtime / Firmware'}
            {' '}<span style={{ fontSize: '0.75rem', color: '#616161' }}>
              {teeArch === 'aws-nitro' ? '→ becomes PCR1 (kernel)' : '→ becomes measurement 1'}
            </span>
          </label>
          <input
            id="kernel" value={kernelVersion} onChange={(e) => setKernelVersion(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
        </div>

        {/* Application Config */}
        <div data-component="form-field">
          <label htmlFor="config">
            {teeArch === 'aws-nitro' ? 'Application Config' : teeArch === 'intel-tdx' ? 'Compose File (RTMR3 in dstack)' : 'Application Manifest'}
            {' '}<span style={{ fontSize: '0.75rem', color: '#616161' }}>
              {teeArch === 'aws-nitro' ? '→ becomes PCR2 (application)' : '→ becomes measurement 2'}
            </span>
          </label>
          <textarea
            id="config" value={appConfig} onChange={(e) => setAppConfig(e.target.value)}
            rows={4} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
        </div>

        <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
          <h3>Simulation Flow</h3>
          <p style={{ fontSize: '0.8rem', color: '#616161', lineHeight: 1.6 }}>
            1. Compute PCR-like hashes from your inputs (keccak256 of each field)<br />
            2. Call MockTeeVerifier.verify{teeArch === 'aws-nitro' ? 'Nitro' : teeArch === 'intel-tdx' ? 'Tdx' : ''}() on-chain<br />
            3. Verifier computes codeMeasurement = keccak256(pcr0 || pcr1 || pcr2)<br />
            4. Record validation in AgentValidationProfile<br />
            5. Generate evidence bundle
          </p>
          <dl>
            <dt>MockTeeVerifier</dt><dd data-component="address">{verifierAddress}</dd>
          </dl>
        </div>

        {error && <p role="alert" data-component="error-message">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Simulating TEE attestation...' : 'Simulate Attestation + Record Validation'}
        </button>
      </form>

      {/* Results */}
      {result && (
        <div data-component="deploy-success" style={{ marginTop: '1.5rem' }}>
          <h2>TEE Attestation Simulated</h2>

          <div data-component="protocol-info">
            <h3>Computed Measurements</h3>
            <dl>
              <dt>{teeArch === 'aws-nitro' ? 'PCR0 (image)' : 'Measurement 0'}</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{result.pcr0}</dd>
              <dt>{teeArch === 'aws-nitro' ? 'PCR1 (kernel)' : 'Measurement 1'}</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{result.pcr1}</dd>
              <dt>{teeArch === 'aws-nitro' ? 'PCR2 (app)' : 'Measurement 2'}</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{result.pcr2}</dd>
            </dl>
            <h3>Code Measurement (bytes32)</h3>
            <dl>
              <dt>keccak256(m0 || m1 || m2)</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#2e7d32' }}>{result.codeMeasurement}</dd>
            </dl>
            <h3>On-Chain Record</h3>
            <dl>
              <dt>Validation ID</dt><dd>{result.validationId}</dd>
              <dt>Tx Hash</dt><dd style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{result.txHash}</dd>
            </dl>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => router.push('/tee')}>View All Validations</button>
          </div>
        </div>
      )}
    </div>
  )
}
