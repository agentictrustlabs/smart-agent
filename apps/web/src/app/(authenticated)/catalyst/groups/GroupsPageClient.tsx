'use client'

import { useState } from 'react'
import { GroupHierarchy, type GroupNode } from '@/components/catalyst/GroupHierarchy'
import { CircleMapView, type CircleMapNode } from '@/components/catalyst/CircleMapView'

interface Props {
  groups: GroupNode[]
  mapNodes: CircleMapNode[]
  orgAddress: string
}

export function GroupsPageClient({ groups, mapNodes, orgAddress }: Props) {
  const [view, setView] = useState<'tree' | 'map'>('tree')

  const pillBase: React.CSSProperties = {
    padding: '0.35rem 1rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    borderRadius: '999px',
    cursor: 'pointer',
    border: '1.5px solid #8b5e3c',
    transition: 'all 0.15s ease',
  }

  const pillActive: React.CSSProperties = {
    ...pillBase,
    background: '#8b5e3c',
    color: 'white',
  }

  const pillInactive: React.CSSProperties = {
    ...pillBase,
    background: 'white',
    color: '#8b5e3c',
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
        <button onClick={() => setView('tree')} style={view === 'tree' ? pillActive : pillInactive}>
          Tree
        </button>
        <button onClick={() => setView('map')} style={view === 'map' ? pillActive : pillInactive}>
          Map
        </button>
      </div>
      {view === 'tree' && <GroupHierarchy groups={groups} orgAddress={orgAddress} />}
      {view === 'map' && <CircleMapView circles={mapNodes} />}
    </div>
  )
}
