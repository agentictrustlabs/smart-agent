/** @sa-route dev-only @sa-prod-gate requireDev */
import { NextResponse } from 'next/server'
import { setAgentStringProperty, updateAgentCore } from '@/lib/actions/explorer-edit.action'
import { requireDev } from '@/lib/env-guard'

/**
 * Explorer edit route — writes on-chain agent properties.
 *
 * Currently has NO caller auth, so it is locked behind `requireDev()`
 * until a proper delegation-bearing wrapper is added (Phase 1B).
 * Returns 404 in production.
 */
export async function POST(request: Request) {
  const denied = requireDev()
  if (denied) return denied

  const body = await request.json()
  const { action, agentAddress, key, value, displayName, description } = body

  if (action === 'setProperty') {
    if (!agentAddress || !key) return NextResponse.json({ success: false, error: 'Missing fields' })
    const result = await setAgentStringProperty(agentAddress, key, value ?? '')
    return NextResponse.json(result)
  }

  if (action === 'updateCore') {
    if (!agentAddress || !displayName) return NextResponse.json({ success: false, error: 'Missing fields' })
    const result = await updateAgentCore(agentAddress, displayName, description ?? '')
    return NextResponse.json(result)
  }

  return NextResponse.json({ success: false, error: 'Unknown action' })
}
