/**
 * POST /wallet/match-against-public-set
 *
 * Consent-gated trust-overlap match.
 *
 *   Caller signs a `MatchAgainstPublicSet` WalletAction whose
 *   `proofRequestHash` commits to a body containing:
 *     { policyId, blockPin, candidates: [{ id, publicSet }] }
 *
 *   This route:
 *     1. Verifies the signed envelope (gateExistingWalletAction).
 *     2. Recomputes keccak(canonicalJson(body)) and rejects if it doesn't
 *        match action.proofRequestHash — the candidate list cannot be
 *        swapped out from under the signature.
 *     3. Builds the caller's heldSet:
 *          on-chain HAS_MEMBER edges (subject = Org, object = principal)
 *          ∪ AnonCreds-held org credentials in this holder wallet
 *     4. Computes per-candidate { score, sharedCount, evidenceCommit }.
 *     5. Persists one ssi_proof_audit row per scored candidate.
 *     6. Returns score-only output. Bob is never contacted.
 *
 * Output shape (score-only):
 *   {
 *     policyId, blockPin,
 *     hits: [{ id, score, sharedCount, evidenceCommit }, …]
 *   }
 *
 * No part of the heldSet leaves the MCP — only the keccak commit does.
 */

import { Hono } from 'hono'
import {
  hashMatchBody,
  evidenceCommit,
  trustScore,
  sharedCount,
  publicSetCommit,
  canonicalOrgId,
  type MatchAgainstPublicSetBody,
  type WalletAction,
} from '@smart-agent/privacy-creds'
import { gateExistingWalletAction } from '../auth/verify-wallet-action.js'
import { listCredentialMetadata } from '../storage/cred-metadata.js'
import { insertProofAudit } from '../storage/proof-audit.js'
import { getOnChainOrgsForPrincipal, addrFromDidEthr } from '../registry/on-chain-orgs.js'

export const matchPublicSetRoutes = new Hono()

interface MatchRequestBody {
  action: WalletAction & { expiresAt: string | number | bigint }
  signature: `0x${string}`
  body: MatchAgainstPublicSetBody
}

interface MatchHit {
  id: string
  score: number
  sharedCount: number
  evidenceCommit: `0x${string}`
}

matchPublicSetRoutes.post('/wallet/match-against-public-set', async (c) => {
  const req = await c.req.json<MatchRequestBody>()

  const action: WalletAction = { ...req.action, expiresAt: BigInt(req.action.expiresAt) }
  if (action.type !== 'MatchAgainstPublicSet') {
    return c.json({ error: `unexpected action type: ${action.type}` }, 400)
  }

  const expectedHash = hashMatchBody(req.body)
  if (expectedHash.toLowerCase() !== action.proofRequestHash.toLowerCase()) {
    return c.json({ error: 'proofRequestHash does not commit to body' }, 400)
  }

  const gate = await gateExistingWalletAction({ action, signature: req.signature })
  if (!gate.ok) return c.json({ error: gate.reason }, gate.status as 400 | 401 | 404 | 409)
  const hw = gate.holderWallet

  // Build caller's heldSet — strictly local. Canonicalised for stable commits.
  // `callerAddress` is the on-chain person-agent address, signed-over via the
  // body's keccak (proofRequestHash). The wallet's personPrincipal is a
  // logical id ("person_<uuid>"), not an EVM address.
  const callerAddr = canonicalOrgId(req.body.callerAddress) as `0x${string}`
  const onChain = await getOnChainOrgsForPrincipal(callerAddr)
  const heldOnChain = onChain.map(canonicalOrgId)

  const heldAnonCreds: string[] = []
  for (const cred of listCredentialMetadata(hw.id)) {
    if (cred.status !== 'active') continue
    if (!cred.credentialType.toLowerCase().includes('membership')) continue
    const addr = addrFromDidEthr(cred.issuerId)
    if (addr) heldAnonCreds.push(canonicalOrgId(addr))
  }

  const heldSet = Array.from(new Set([...heldOnChain, ...heldAnonCreds]))
  const blockPin = req.body.blockPin && req.body.blockPin !== '0' ? BigInt(req.body.blockPin) : undefined

  const hits: MatchHit[] = req.body.candidates.map(cand => {
    const score = trustScore({ publicSet: cand.publicSet, heldSet, blockPin })
    const shared = sharedCount(cand.publicSet, heldSet)
    const commit = evidenceCommit({
      publicSet: cand.publicSet,
      heldSet,
      policyId: req.body.policyId,
      blockPin,
    })
    return { id: cand.id, score, sharedCount: shared, evidenceCommit: commit }
  })

  // Persist score-only audit. Bob never sees this; preimage stays in the wallet.
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const cand = req.body.candidates[i]
    insertProofAudit({
      holderWalletId: hw.id,
      principal: hw.personPrincipal,
      counterpartyId: `discovery:peer:${h.id.toLowerCase()}`,
      policyId: req.body.policyId,
      blockPin: req.body.blockPin,
      publicSetCommit: publicSetCommit(cand.publicSet),
      evidenceCommit: h.evidenceCommit,
      score: h.score,
      sharedCount: h.sharedCount,
    })
  }

  return c.json({
    policyId: req.body.policyId,
    blockPin: req.body.blockPin,
    hits,
  })
})
