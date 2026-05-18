/** @sa-route bootstrap @sa-auth none-with-csrf @sa-risk-tier high @sa-owner security */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAddress, createWalletClient, http } from 'viem'
import { foundry, sepolia } from 'viem/chains'
import { agentAccountFactoryAbi } from '@smart-agent/sdk'
import {
  decodeAndVerifyIdToken,
  deriveSaltFromEmail,
  exchangeCode,
  getGoogleEnv,
  googleDid,
  STATE_COOKIE,
  NONCE_COOKIE,
  INTENT_COOKIE,
  RETURN_TO_COOKIE,
} from '@/lib/auth/google-oauth'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getSmartAccountAddress, getPublicClient, getDeployedContracts } from '@/lib/contracts'
import { getAuthBootstrapSigner } from '@/lib/key-custody/tool-executor'
import { agentAccountAbi, agentAccountResolverAbi, ATL_PRIMARY_NAME } from '@smart-agent/sdk'
import { resolveUserHomePath } from '@/lib/post-login-redirect'

/**
 * GET /api/auth/google-callback?code=…&state=…
 *
 * 1. Verify the `state` cookie matches Google's echo (CSRF defence).
 * 2. Exchange the code for an id_token (server↔Google over TLS, with our
 *    client_secret authenticating us).
 * 3. Decode + verify aud/iss/nonce/exp.
 * 4. Derive the user's deterministic smart-account salt from email.
 * 5. Deploy the account if needed (server EOA = initial owner via factory's
 *    serverSigner mode).
 * 6. Upsert a row in `users`, mint our native session JWT, set the cookie.
 * 7. Redirect to the user's resolved home (their hub-specific URL via
 *    /h/{slug}/home, or /dashboard if no hub yet).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(error)}`, url))
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/sign-in?error=missing_code', url))
  }

  const jar = await cookies()
  const stateCookie = jar.get(STATE_COOKIE)?.value
  const nonceCookie = jar.get(NONCE_COOKIE)?.value
  if (!stateCookie || stateCookie !== state) {
    return NextResponse.redirect(new URL('/sign-in?error=state_mismatch', url))
  }
  if (!nonceCookie) {
    return NextResponse.redirect(new URL('/sign-in?error=missing_nonce', url))
  }

  let env
  try { env = getGoogleEnv() } catch (e) {
    // Don't leak internal env-var names / OAuth client IDs into the
    // URL bar; log the detail and redirect with a generic code.
    console.error('[google-callback] env load failed', {
      errorCode: 'google-env-failed',
      errorMessage: (e as Error).message,
    })
    return NextResponse.redirect(new URL('/sign-in?error=oauth_config_unavailable', url))
  }

  let claims
  try {
    const tok = await exchangeCode(env, code)
    claims = decodeAndVerifyIdToken(tok.id_token, env, nonceCookie)
  } catch (e) {
    // Don't leak token-exchange / id-token verification internals.
    console.error('[google-callback] token exchange or id_token verification failed', {
      errorCode: 'google-token-failed',
      errorMessage: (e as Error).message,
    })
    return NextResponse.redirect(new URL('/sign-in?error=oauth_verification_failed', url))
  }

  // K6 S1.5 — sign bootstrap operations with the dedicated `auth-bootstrap`
  // tool-executor key (separate KMS slot in prod). The signer is also the
  // initial owner of the freshly-deployed smart account; that gives the
  // server the ability to send the addPasskey UserOp on /passkey-enroll
  // before the user has any other on-chain owner. The deployer key is no
  // longer read in this route.
  const bootstrap = await getAuthBootstrapSigner()
  const serverEOA = bootstrap.address

  // Look up existing user FIRST so we can pick up their salt rotation. New
  // users default to rotation=0; users who pressed "Start fresh" have a
  // bumped rotation that maps to a different smart-account address.
  const did = googleDid(claims.sub)
  const existing = await db.select().from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.did, did)).limit(1).then(r => r[0])
  const rotation = existing?.accountSaltRotation ?? 0

  // Derive the smart-account address deterministically from the verified
  // email + rotation. The MAC primitive is provider-backed (Sprint S2.6 —
  // `oauth-salt` KMS HMAC key); the call is async because `kms:GenerateMac`
  // is a network round-trip in production.
  const salt = await deriveSaltFromEmail(claims.email, rotation)
  const counterfactual = await getSmartAccountAddress(serverEOA, salt)
  const smartAcct = await deploySmartAccountWithBootstrap(serverEOA, salt, bootstrap)
  if (smartAcct.toLowerCase() !== counterfactual.toLowerCase()) {
    // Sanity: the deployed address should equal the counterfactual.
    return NextResponse.redirect(new URL('/sign-in?error=address_mismatch', url))
  }

  let userId: string
  if (existing) {
    userId = existing.id
    // Backfill smartAccountAddress if it was null (older row).
    if (!existing.smartAccountAddress) {
      await db.update(schema.localUserAccounts)
        .set({ smartAccountAddress: getAddress(smartAcct).toLowerCase() as `0x${string}` })
        .where(eq(schema.localUserAccounts.id, existing.id))
    }
  } else {
    // OAuth users have no EOA — store the smart account address as walletAddress
    // (the schema's NOT NULL UNIQUE constraint requires *some* unique value).
    // smartAccountAddress equals walletAddress for these users, by design.
    userId = `gsub:${claims.sub}`
    await db.insert(schema.localUserAccounts).values({
      id: userId,
      email: claims.email,
      name: claims.name ?? claims.email.split('@')[0] ?? 'Google User',
      walletAddress: getAddress(smartAcct).toLowerCase() as `0x${string}`,
      did: did,
      privateKey: null,
      smartAccountAddress: getAddress(smartAcct).toLowerCase() as `0x${string}`,
      personAgentAddress: null,
    })
  }

  const row = await db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, userId)).limit(1).then(r => r[0])!
  if (!row) {
    return NextResponse.redirect(new URL('/sign-in?error=user_lookup_failed', url))
  }

  const jwt = mintSession({
    sub: did,
    walletAddress: row.walletAddress,
    smartAccountAddress: row.smartAccountAddress,
    name: row.name,
    email: row.email ?? claims.email,
    via: 'google',
    kind: 'session',
  })

  // Routing priority:
  //   1. Recovery intent always wins — even for brand-new accounts the user
  //      explicitly opted into the timelocked recovery path.
  //   2. Onboarding incomplete → /onboarding. CRITICAL: registration MUST
  //      happen while the bootstrap server is still in `_owners`. /passkey-
  //      enroll removes the server (Phase 2), after which any deployer-signed
  //      resolver write reverts with NotAgentOwner.
  //   3. No passkey on the account → /passkey-enroll.
  //   4. Otherwise → user's resolved hub home (or /dashboard if no hub).
  const intent = jar.get(INTENT_COOKIE)?.value
  let passkeyCount = 0n
  try {
    passkeyCount = await getPublicClient().readContract({
      address: getAddress(smartAcct as `0x${string}`),
      abi: agentAccountAbi,
      functionName: 'passkeyCount',
    }) as bigint
  } catch { /* account may be too new; treat as 0 */ }

  // Quick onboarding check — only the bits we need for the routing decision.
  let onboardingComplete = false
  try {
    const accountResolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (accountResolver) {
      const pub = getPublicClient()
      const isReg = await pub.readContract({
        address: accountResolver, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [getAddress(smartAcct as `0x${string}`)],
      }) as boolean
      const primaryName = isReg ? await pub.readContract({
        address: accountResolver, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [getAddress(smartAcct as `0x${string}`), ATL_PRIMARY_NAME as `0x${string}`],
      }) as string : ''
      const profileComplete = !!row.name && row.name !== 'Agent User'
      onboardingComplete = profileComplete && isReg && !!primaryName
    }
  } catch { /* assume incomplete on error */ }

  // Honor return_to (set by google-start when the caller passed
  // ?return_to=/h/{slug}). For hub-context onboarding we always want the
  // user back on /h/{slug}, where the state machine resumes seamlessly.
  // Recovery and missing-passkey flows still take precedence — those are
  // server-driven security paths the user must complete.
  const returnTo = jar.get(RETURN_TO_COOKIE)?.value ?? ''
  let nextPath: string
  if (intent === 'recover') {
    nextPath = '/recover-device'
  } else if (passkeyCount === 0n) {
    nextPath = '/passkey-enroll'
  } else if (returnTo) {
    nextPath = returnTo
  } else if (!onboardingComplete) {
    nextPath = '/onboarding'
  } else {
    nextPath = await resolveUserHomePath(userId)
  }
  const target = new URL(nextPath, url)
  const res = NextResponse.redirect(target)
  res.cookies.set(SESSION_COOKIE, jwt, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  // Clear the OAuth one-shots.
  res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
  res.cookies.set(NONCE_COOKIE, '', { path: '/', maxAge: 0 })
  res.cookies.set(INTENT_COOKIE, '', { path: '/', maxAge: 0 })
  res.cookies.set(RETURN_TO_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

/**
 * K6 S1.5 — local helper that mirrors `deploySmartAccount()` from
 * `@/lib/contracts` but signs with the supplied bootstrap `LocalAccount`
 * instead of the shared deployer wallet. We don't share the deployer's
 * process-wide nonce lock here because the bootstrap signer is a
 * DIFFERENT EOA (separate KMS slot in prod) — its nonce space is
 * independent of the deployer's. Viem's default nonce handling per
 * wallet-client is sufficient for the one write this route performs.
 */
async function deploySmartAccountWithBootstrap(
  owner: `0x${string}`,
  salt: bigint,
  bootstrap: Awaited<ReturnType<typeof getAuthBootstrapSigner>>,
): Promise<`0x${string}`> {
  const publicClient = getPublicClient()
  const contracts = getDeployedContracts()

  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
  const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  const chain = CHAIN_ID === 11155111 ? sepolia : foundry

  // Already deployed? Return early.
  const address = (await publicClient.readContract({
    address: contracts.agentAccountFactory,
    abi: agentAccountFactoryAbi,
    functionName: 'getAddress',
    args: [owner, salt],
  })) as `0x${string}`
  const code = await publicClient.getCode({ address })
  if (code && code !== '0x') return address

  const wallet = createWalletClient({
    account: bootstrap,
    chain,
    transport: http(RPC_URL),
  })
  const hash = await wallet.writeContract({
    address: contracts.agentAccountFactory,
    abi: agentAccountFactoryAbi,
    functionName: 'createAccount',
    args: [owner, salt],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return address
}
