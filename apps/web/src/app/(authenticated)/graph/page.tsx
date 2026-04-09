import { TrustGraphView } from '@/components/graph/TrustGraphView'

export default function GraphPage() {
  return (
    <div data-page="graph">
      <div data-component="page-header">
        <h1>Trust Graph Visualization</h1>
        <p>
          Interactive view of on-chain agent relationships.
          Hover nodes to highlight connections. Click edges for details.
        </p>
      </div>
      <TrustGraphView />
    </div>
  )
}
