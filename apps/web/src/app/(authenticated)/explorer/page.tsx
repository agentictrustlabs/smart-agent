import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getExplorerRoot, getExplorerChildren, getRegistryStats } from '@/lib/actions/explorer.action'
import { ExplorerClient } from '@/components/explorer/ExplorerClient'

export default async function ExplorerPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const root = await getExplorerRoot()
  const stats = await getRegistryStats()

  // Load top-level children (the hub namespaces)
  const initialChildren = root ? await getExplorerChildren(root.node) : []

  return (
    <div>
      <div style={{ marginBottom: '0.5rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.15rem', color: '#5c4a3a' }}>.agent Namespace Explorer</h1>
        <p style={{ fontSize: '0.82rem', color: '#9a8c7e', margin: 0 }}>
          Browse, search, and manage the agent trust graph through hierarchical names.
        </p>
      </div>

      <ExplorerClient
        rootNode={root?.node ?? ''}
        rootChildCount={root?.childCount ?? 0}
        initialChildren={initialChildren}
        stats={stats}
      />
    </div>
  )
}
