'use client'

import { useEffect, useRef } from 'react'

export interface CircleMapNode {
  address: string
  name: string
  parentAddress: string | null
  latitude: number | null
  longitude: number | null
  isEstablished: boolean
  leaderName: string | null
  healthScore?: number
}

interface Props {
  circles: CircleMapNode[]
}

export function CircleMapView({ circles }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)

  useEffect(() => {
    const geoCircles = circles.filter(c => c.latitude != null && c.longitude != null)
    if (!mapRef.current || mapInstance.current || geoCircles.length === 0) return

    // Guard against double-init in React Strict Mode / HMR
    const container = mapRef.current as HTMLDivElement & { _leaflet_id?: number }
    if (container._leaflet_id) return

    import('leaflet').then((L) => {
      const defaultCenter: [number, number] = [40.58, -105.08]
      const defaultZoom = 10

      const map = L.map(mapRef.current!, {
        center: defaultCenter,
        zoom: defaultZoom,
        scrollWheelZoom: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      // Build address-to-circle lookup for parent lines
      const byAddress = new Map<string, CircleMapNode>()
      for (const c of geoCircles) {
        byAddress.set(c.address.toLowerCase(), c)
      }

      // Connection lines between parent and child
      for (const child of geoCircles) {
        if (!child.parentAddress) continue
        const parent = byAddress.get(child.parentAddress.toLowerCase())
        if (!parent || parent.latitude == null || parent.longitude == null) continue
        L.polyline(
          [[parent.latitude, parent.longitude], [child.latitude!, child.longitude!]],
          { color: '#8b5e3c', weight: 1.5, dashArray: '6 4', opacity: 0.5 }
        ).addTo(map)
      }

      // Circle markers
      for (const circle of geoCircles) {
        const color = circle.isEstablished ? '#2e7d32' : '#9e9e9e'
        const r = circle.isEstablished ? 14 : 11
        const dash = circle.isEstablished ? '' : 'stroke-dasharray="4 2"'
        const initial = circle.name.charAt(0).toUpperCase()
        const size = r * 2 + 8

        const icon = L.divIcon({
          className: 'circle-map-pin',
          html: `<div style="display:flex;flex-direction:column;align-items:center;">
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
              <circle cx="${r + 4}" cy="${r + 4}" r="${r}" fill="white" stroke="${color}" stroke-width="2.5" ${dash} />
              <text x="${r + 4}" y="${r + 8}" text-anchor="middle" font-size="9" font-weight="700" fill="${color}">${initial}</text>
            </svg>
            <div style="background:white;border:1px solid #e0e0e0;border-radius:4px;padding:1px 6px;margin-top:-2px;font-size:11px;font-weight:600;color:#292524;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.1);">${circle.name}</div>
          </div>`,
          iconSize: [0, 0],
          iconAnchor: [r + 4, r + 4],
        })

        const marker = L.marker([circle.latitude!, circle.longitude!], { icon }).addTo(map)

        const popupContent = [
          `<strong>${circle.name}</strong>`,
          circle.leaderName ? `Leader: ${circle.leaderName}` : null,
          circle.isEstablished ? 'Established Church' : 'Gathering',
          circle.healthScore != null && circle.healthScore > 0 ? `Health Score: ${circle.healthScore}` : null,
        ].filter(Boolean).join('<br/>')

        marker.bindPopup(popupContent)
      }

      // Fit bounds to all markers
      if (geoCircles.length > 1) {
        const bounds = L.latLngBounds(
          geoCircles.map(c => [c.latitude!, c.longitude!] as [number, number])
        )
        map.fitBounds(bounds, { padding: [40, 40] })
      } else if (geoCircles.length === 1) {
        map.setView([geoCircles[0].latitude!, geoCircles[0].longitude!], 13)
      }

      mapInstance.current = map
    })

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
      // Clear leaflet's internal ID so re-init works after HMR
      if (mapRef.current) {
        delete (mapRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id
      }
    }
  }, [circles])

  const hasGeo = circles.some(c => c.latitude != null && c.longitude != null)

  if (!hasGeo) {
    return (
      <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>
        No circles with location data. Add latitude/longitude to circle health data to see them on the map.
      </p>
    )
  }

  return (
    <div
      ref={mapRef}
      style={{
        width: '100%',
        height: 500,
        borderRadius: 10,
        border: '1px solid #e0e0e0',
      }}
    />
  )
}
