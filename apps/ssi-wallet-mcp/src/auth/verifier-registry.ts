/**
 * Known-verifier registry. For now a static list keyed by verifier DID (or
 * explicit EOA) — configured via SSI_KNOWN_VERIFIERS env var. Phase-7
 * upgrade path: anchor on-chain in CredentialRegistry.sol the same way
 * issuers are anchored.
 *
 * SSI_KNOWN_VERIFIERS format: "did1=0xADDR1,did2=0xADDR2"
 * Empty / unset → verifier-signing is NOT enforced (demo-friendly default).
 */

import { verifyPresentationRequestSignature } from '@smart-agent/privacy-creds'

export interface VerifierSignatureCheck {
  ok: boolean
  reason?: string
  enforced: boolean              // false = registry empty, caller may proceed
  verifierId?: string
  verifierAddress?: `0x${string}`
}

function parseKnown(): Map<string, `0x${string}`> {
  const raw = process.env.SSI_KNOWN_VERIFIERS ?? ''
  const out = new Map<string, `0x${string}`>()
  for (const pair of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const [id, addr] = pair.split('=')
    if (id && addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) out.set(id, addr as `0x${string}`)
  }
  return out
}

const knownVerifiers = parseKnown()

export async function checkVerifierSignature(input: {
  presentationRequest: unknown
  verifierId?: string
  verifierAddress?: `0x${string}`
  signature?: `0x${string}`
}): Promise<VerifierSignatureCheck> {
  if (knownVerifiers.size === 0) {
    return { ok: true, enforced: false }
  }
  if (!input.verifierId || !input.signature) {
    return { ok: false, enforced: true, reason: 'verifierId + signature required' }
  }
  const expected = knownVerifiers.get(input.verifierId)
  if (!expected) {
    return { ok: false, enforced: true, reason: `unknown verifier: ${input.verifierId}` }
  }
  if (input.verifierAddress && input.verifierAddress.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, enforced: true, reason: 'verifierAddress does not match registered EOA' }
  }
  const sigOk = await verifyPresentationRequestSignature(expected, input.presentationRequest, input.signature)
  if (!sigOk) return { ok: false, enforced: true, reason: 'verifier signature invalid' }
  return { ok: true, enforced: true, verifierId: input.verifierId, verifierAddress: expected }
}
