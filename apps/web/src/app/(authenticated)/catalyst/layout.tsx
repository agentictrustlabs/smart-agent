/**
 * Catalyst sub-layout — passthrough.
 * The hub-driven navigation is handled by the parent authenticated layout
 * via HubLayout. This file exists only to preserve the route segment.
 */
export default function CatalystLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
