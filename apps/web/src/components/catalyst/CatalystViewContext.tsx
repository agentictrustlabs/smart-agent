'use client'

import { createContext, useContext } from 'react'

export type ViewMode = 'disciple' | 'coach'

export interface CatalystViewContextValue {
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
}

export const CatalystViewCtx = createContext<CatalystViewContextValue>({
  viewMode: 'disciple',
  setViewMode: () => {},
})

export function useCatalystView() {
  return useContext(CatalystViewCtx)
}
