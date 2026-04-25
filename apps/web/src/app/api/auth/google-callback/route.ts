import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { privateKeyToAccount } from 'viem/accounts'
import { getAddress } from 'viem'
import {
  decodeAndVerifyIdToken,
  deriveSaltFromEmail,
  exchangeCode,
  getGoogleEnv,
  googleDid,
  STATE_COOKIE,
  NONCE_COOKIE,
  INTENT_COOKIE,
} from '@/lib/auth/google-oauth'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { deploySmartAccount, getSmartAccountAddress, getPublicClient } from '@/lib/contracts'
import { agentAccountAbi, agentAccountResolverAbi, ATL_PRIMARY_NAME } from '@smart-agent/sdk'

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
 * 7. Redirect to /catalyst (or to the post-Google enrolment landing page if
 *    the account has no passkeys yet — handled in Phase 2).
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
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent((e as Error).message)}`, url))
  }

  let claims
  try {
    const tok = await exchangeCode(env, code)
    claims = decodeAndVerifyIdToken(tok.id_token, env, nonceCookie)
  } catch (e) {
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent((e as Error).message)}`, url))
  }

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
  if (!deployerKey) {
    return NextResponse.redirect(new URL('/sign-in?error=deployer_key_unset', url))
  }
  const serverEOA = privateKeyToAccount(deployerKey).address as `0x${string}`

  // Look up existing user FIRST so we can pick up their salt rotation. New
  // users default to rotation=0; users who pressed "Start fresh" have a
  // bumped rotation that maps to a different smart-account address.
  const did = googleDid(claims.sub)
  const existing = await db.select().from(schema.users)
    .where(eq(schema.users.privyUserId, did)).limit(1).then(r => r[0])
  const rotation = existing?.accountSaltRotation ?? 0

  // Derive the smart-account address deterministically from the verified
  // email + rotation.
  const salt = deriveSaltFromEmail(claims.email, rotation)
  const counterfactual = await getSmartAccountAddress(serverEOA, salt)
  const smartAcct = await deploySmartAccount(serverEOA, salt)
  if (smartAcct.toLowerCase() !== counterfactual.toLowerCase()) {
    // Sanity: the deployed address should equal the counterfactual.
    return NextResponse.redirect(new URL('/sign-in?error=address_mismatch', url))
  }

  let userId: string
  if (existing) {
    userId = existing.id
    // Backfill smartAccountAddress if it was null (older row).
    if (!existing.smartAccountAddress) {
      await db.update(schema.users)
        .set({ smartAccountAddress: getAddress(smartAcct).toLowerCase() as `0x${string}` })
        .where(eq(schema.users.id, existing.id))
    }
  } else {
    // OAuth users have no EOA — store the smart account address as walletAddress
    // (the schema's NOT NULL UNIQUE constraint requires *some* unique value).
    // smartAccountAddress equals walletAddress for these users, by design.
    userId = `gsub:${claims.sub}`
    await db.insert(schema.users).values({
      id: userId,
      email: claims.email,
      name: claims.name ?? claims.email.split('@')[0] ?? 'Google User',
      walletAddress: getAddress(smartAcct).toLowerCase() as `0x${string}`,
      privyUserId: did,
      privateKey: null,
      smartAccountAddress: getAddress(smartAcct).toLowerCase() as `0x${string}`,
      personAgentAddress: null,
    })
  }

  const row = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1).then(r => r[0])!
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
  //   4. Otherwise → /catalyst.
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

  let nextPath: string
  if (intent === 'recover') {
    nextPath = '/recover-device'
  } else if (!onboardingComplete) {
    nextPath = '/onboarding'
  } else if (passkeyCount === 0n) {
    nextPath = '/passkey-enroll'
  } else {
    nextPath = '/catalyst'
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
  return res
}
