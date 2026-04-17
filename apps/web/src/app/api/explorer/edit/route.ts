import { NextResponse } from 'next/server'
import { setAgentStringProperty, updateAgentCore } from '@/lib/actions/explorer-edit.action'

export async function POST(request: Request) {
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
