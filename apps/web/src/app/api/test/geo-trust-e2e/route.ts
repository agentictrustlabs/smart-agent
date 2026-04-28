/**
 * Test-only E2E for the geo-trust-overlap fix.
 *
 *   POST /api/test/geo-trust-e2e
 *
 * Caller is whichever demo user is currently logged in via /api/demo-login.
 * Runs:
 *   1. provision the holder wallet (idempotent)
 *   2. issue a held GeoLocationCredential for the Loveland feature
 *   3. run trust-search and return the hits
 *
 * Returns a JSON shape the operator can eyeball to confirm geo overlap is
 * picking up held credentials. Disabled in production via NODE_ENV check.
 */

import { NextResponse } from 'next/server'
import { createPublicClient, http, getAddress } from 'viem'
import { localhost } from 'viem/chains'
import { GeoFeatureClient, geoFeatureRegistryAbi } from '@smart-agent/sdk'
import { getSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import {
  prepareWalletProvisionIfNeeded,
  submitWalletProvision,
  provisionHolderWalletViaSession,
} from '@/lib/actions/ssi/wallet-provision.action'
import {
  prepareCredentialIssuance,
  completeCredentialIssuance,
  issueCredentialViaSession,
} from '@/lib/actions/ssi/request-credential.action'
import { runTrustSearchViaSession, prepareTrustSearch, completeTrustSearch } from '@/lib/actions/trust-search.action'
import { signWalletAction } from '@/lib/ssi/signer'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'test endpoint disabled in production' }, { status: 403 })
  }

  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'not authenticated' }, { status: 401 })

  // ─── 1. Provision the holder wallet (session path → legacy fallback) ─
  let holderWalletId: string | null = null
  let walletContext: string | null = null
  const sessionProv = await provisionHolderWalletViaSession()
  if (sessionProv.success && sessionProv.holderWalletId && sessionProv.walletContext) {
    holderWalletId = sessionProv.holderWalletId
    walletContext  = sessionProv.walletContext
  } else if (sessionProv.errorCode !== 'no_session') {
    return NextResponse.json({ error: `session provision failed: ${sessionProv.error}` }, { status: 500 })
  } else {
    // Demo-user fallback — no grant cookie. Use the EOA-signed legacy chain.
    const prep = await prepareWalletProvisionIfNeeded()
    if (!prep.success || !prep.signer) {
      return NextResponse.json({ error: prep.error ?? 'prepare provision failed' }, { status: 500 })
    }
    if (prep.alreadyProvisioned) {
      holderWalletId = prep.alreadyProvisioned.holderWalletId
      walletContext  = prep.alreadyProvisioned.walletContext
    } else if (prep.needsProvision) {
      // Demo users have a stored EOA private key; sign server-side.
      const { signature } = await signWalletAction({
        ...prep.needsProvision.action,
        expiresAt: BigInt(prep.needsProvision.action.expiresAt),
      })
      const subm = await submitWalletProvision({
        action: prep.needsProvision.action,
        signature,
      })
      if (!subm.success || !subm.holderWalletId) {
        return NextResponse.json({ error: subm.error ?? 'provision submit failed' }, { status: 500 })
      }
      holderWalletId = subm.holderWalletId
      walletContext  = subm.walletContext ?? 'default'
    }
  }
  if (!holderWalletId || !walletContext) {
    return NextResponse.json({ error: 'no holder wallet' }, { status: 500 })
  }

  // ─── 2. Look up the Loveland feature on chain so we can attach
  //         featureId + featureName to the credential. ───────────────
  const featureRegistry = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!featureRegistry) {
    return NextResponse.json({ error: 'GEO_FEATURE_REGISTRY_ADDRESS not configured' }, { status: 500 })
  }
  const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
  const featureId = GeoFeatureClient.featureIdFor({ countryCode: 'us', region: 'colorado', city: 'loveland' })
  const featureVersion = await publicClient.readContract({
    address: featureRegistry, abi: geoFeatureRegistryAbi,
    functionName: 'latestVersion', args: [featureId],
  }) as bigint
  if (featureVersion === 0n) {
    return NextResponse.json({ error: 'Loveland feature not registered on chain' }, { status: 500 })
  }

  const attestedAt = Math.floor(Date.now() / 1000).toString()
  const attributes: Record<string, string> = {
    featureId,
    featureName: 'loveland.colorado.us.geo',
    city: 'loveland',
    region: 'colorado',
    country: 'us',
    relation: 'residentOf',
    confidence: '80',
    validFrom: '0',
    validUntil: '0',
    attestedAt,
  }

  // ─── 3. Issue the credential ─────────────────────────────────────
  let credentialId: string | null = null
  const sessionIssue = await issueCredentialViaSession({
    credentialType: 'GeoLocationCredential',
    holderWalletId,
    walletContext,
    attributes,
  })
  if (sessionIssue.success && sessionIssue.credentialId) {
    credentialId = sessionIssue.credentialId
  } else if (sessionIssue.errorCode !== 'no_session') {
    return NextResponse.json({ error: `session issue failed: ${sessionIssue.error}` }, { status: 500 })
  } else {
    // Legacy EOA-signed path for demo users.
    const accept = await prepareCredentialIssuance({
      credentialType: 'GeoLocationCredential',
      holderWalletId, walletContext,
      attributes,
    })
    if (!accept.success || !accept.signer || !accept.toSign || !accept.offer || !accept.attributes) {
      return NextResponse.json({ error: accept.error ?? 'prepare issuance failed' }, { status: 500 })
    }
    const { signature: acceptSig } = await signWalletAction({
      ...accept.toSign.action,
      expiresAt: BigInt(accept.toSign.action.expiresAt),
    })
    const fin = await completeCredentialIssuance({
      credentialType: 'GeoLocationCredential',
      action: accept.toSign.action,
      signature: acceptSig,
      holderWalletId, walletContext,
      offer: accept.offer,
      attributes: accept.attributes,
    })
    if (!fin.success || !fin.credentialId) {
      return NextResponse.json({ error: fin.error ?? 'complete issuance failed' }, { status: 500 })
    }
    credentialId = fin.credentialId
  }

  // ─── 4. Run trust search and return hits with geo scores ─────────
  let hits: Array<{ address: string; score: number; orgScore: number; geoScore: number; geoExplanation?: Array<{ relation: string; contribution: number }> }> = []
  let searchPath: 'session' | 'legacy' | 'failed' = 'failed'
  let searchError: string | undefined

  const sessionSearch = await runTrustSearchViaSession({ limit: 100 })
  if (sessionSearch.status === 'ready') {
    hits = sessionSearch.hits.map(h => ({
      address: h.address, score: h.score, orgScore: h.orgScore, geoScore: h.geoScore,
      geoExplanation: h.geoExplanation,
    }))
    searchPath = 'session'
  } else {
    // Legacy fallback for demo users.
    const prep = await prepareTrustSearch({ limit: 100 })
    if (prep.status !== 'ready' || !prep.action || !prep.body || !prep.agentMeta) {
      return NextResponse.json({
        ok: false, step: 'trust-search-prepare',
        credentialId, holderWalletId,
        error: prep.message ?? 'prepare failed',
      }, { status: 500 })
    }
    const { signature: searchSig } = await signWalletAction({
      ...prep.action, expiresAt: BigInt(prep.action.expiresAt),
    })
    const res = await completeTrustSearch({
      action: prep.action, signature: searchSig, body: prep.body,
      agentMeta: prep.agentMeta, callerGeo: prep.callerGeo ?? null,
    })
    if (res.error) {
      searchPath = 'failed'
      searchError = res.error
    } else {
      hits = res.hits.map(h => ({
        address: h.address, score: h.score, orgScore: h.orgScore, geoScore: h.geoScore,
        geoExplanation: h.geoExplanation,
      }))
      searchPath = 'legacy'
    }
  }

  // Find the Luis row (cat-user-009) — public residentOf loveland on chain.
  const ctx = await loadSignerForCurrentUser()
  const callerRow = await db.select().from(schema.users)
    .where(eq(schema.users.id, ctx.userRow.id)).limit(1).then(r => r[0])

  // Trust-search candidates are PERSON AGENTS, not smart-account addresses.
  // Look Luis's person agent up the same way prepareTrustSearch does.
  const luisAgentRaw = await getPersonAgentForUser('cat-user-009')
  const luisAgent = luisAgentRaw ? getAddress(luisAgentRaw as `0x${string}`) : null
  const luisHit = luisAgent
    ? hits.find(h => h.address.toLowerCase() === luisAgent.toLowerCase())
    : undefined

  return NextResponse.json({
    ok: true,
    caller: { id: callerRow?.id, name: callerRow?.name },
    holderWalletId,
    issued: { credentialId, featureId, relation: 'residentOf', city: 'loveland' },
    searchPath,
    searchError,
    totalHits: hits.length,
    luis: luisHit ? {
      address: luisHit.address,
      score: luisHit.score,
      orgScore: luisHit.orgScore,
      geoScore: luisHit.geoScore,
      geoExplanation: luisHit.geoExplanation,
    } : { address: luisAgent, error: 'not in hits' },
    topGeoHits: hits
      .filter(h => h.geoScore > 0)
      .slice(0, 8)
      .map(h => ({
        address: h.address,
        geoScore: h.geoScore,
        orgScore: h.orgScore,
        geoExplanation: h.geoExplanation,
      })),
  })
}
