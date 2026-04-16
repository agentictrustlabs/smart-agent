import { NextResponse } from 'next/server'
import { getRegistryStats } from '@/lib/actions/explorer.action'

export async function GET() {
  const stats = await getRegistryStats()
  return NextResponse.json(stats)
}
