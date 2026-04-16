import { NextResponse } from 'next/server'
import { getExplorerChildren } from '@/lib/actions/explorer.action'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const node = searchParams.get('node')
  if (!node) return NextResponse.json({ children: [] })

  const children = await getExplorerChildren(node)
  return NextResponse.json({ children })
}
