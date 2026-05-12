import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { fundLocalTreasury } from '@/lib/treasury/provision'

/**
 * Spec 005 — dev-only treasury top-up endpoint.
 *
 * POST /api/treasury/fund
 *   { smartAccountAddress: "0x..." } (optional — falls back to session's own)
 *
 * Gated server-side: must be signed in, target must match session smart
 * account, and chainId === 31337 (enforced inside fundLocalTreasury).
 * Returns { ok, newBalance } as a decimal string (1e6-scaled USDC).
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.smartAccountAddress) {
    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 })
  }
  const sessionAddr = session.smartAccountAddress.toLowerCase()

  let body: { smartAccountAddress?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine — default to session's smart account */
  }
  const requested = (body.smartAccountAddress ?? sessionAddr).toLowerCase()
  if (requested !== sessionAddr) {
    return NextResponse.json(
      { ok: false, error: 'can only fund your own treasury' },
      { status: 403 },
    )
  }

  const r = await fundLocalTreasury(requested as `0x${string}`)
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true, newBalance: r.newBalance.toString() })
}
