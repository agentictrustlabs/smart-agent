import { NextResponse } from 'next/server'
import { getExplorerRecords, getExplorerRelationships } from '@/lib/actions/explorer.action'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')
  const type = searchParams.get('type')

  if (!address) return NextResponse.json({ records: [], relationships: [] })

  if (type === 'relationships') {
    const relationships = await getExplorerRelationships(address)
    return NextResponse.json({ relationships })
  }

  const records = await getExplorerRecords(address)
  return NextResponse.json({ records })
}
