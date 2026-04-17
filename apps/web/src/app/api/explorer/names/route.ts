import { NextResponse } from 'next/server'
import { findAllNamesForAgent, registerAdditionalName, setPrimaryName } from '@/lib/actions/explorer-edit.action'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')
  if (!address) return NextResponse.json({ names: [] })

  const names = await findAllNamesForAgent(address)
  return NextResponse.json({ names })
}

export async function POST(request: Request) {
  const body = await request.json()
  const { action } = body

  if (action === 'register') {
    const { agentAddress, nameLabel, parentNode, parentAgentName } = body
    if (!agentAddress || !nameLabel || !parentNode || !parentAgentName) {
      return NextResponse.json({ success: false, error: 'Missing fields' })
    }
    const result = await registerAdditionalName(agentAddress, nameLabel, parentNode, parentAgentName)
    return NextResponse.json(result)
  }

  if (action === 'setPrimary') {
    const { agentAddress, fullName, nameLabel } = body
    if (!agentAddress || !fullName || !nameLabel) {
      return NextResponse.json({ success: false, error: 'Missing fields' })
    }
    const result = await setPrimaryName(agentAddress, fullName, nameLabel)
    return NextResponse.json(result)
  }

  return NextResponse.json({ success: false, error: 'Unknown action' })
}
