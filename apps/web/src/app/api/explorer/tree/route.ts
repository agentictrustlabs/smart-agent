import { NextResponse } from 'next/server'
import { getExplorerChildren, getAgentRoot } from '@/lib/actions/explorer.action'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const node = searchParams.get('node')
  if (!node) return NextResponse.json({ children: [] })

  const children = await getExplorerChildren(node)
  // Include the resolved root node hash when requesting root
  const rootNode = node === 'root' ? await getAgentRoot() : undefined
  return NextResponse.json({ children, rootNode })
}
