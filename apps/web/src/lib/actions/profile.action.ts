'use server'

import { requireSession } from '@/lib/auth/session'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

export interface ProfileData {
  displayName?: string
  email?: string
  phone?: string
  dateOfBirth?: string
  gender?: string
  language?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  stateProvince?: string
  postalCode?: string
  country?: string
  location?: string
  homeChurch?: string
}

/**
 * Save profile through the delegation chain:
 * Web → A2A agent (mints delegation token + calls person-mcp) → Person MCP
 *
 * The web app NEVER talks to person-mcp directly.
 */
export async function saveProfileViaDelegation(
  a2aSessionToken: string | null,
  data: ProfileData,
): Promise<{ success: boolean; error?: string; profile?: unknown }> {
  await requireSession()

  if (!a2aSessionToken) {
    return { success: false, error: 'No A2A session. Connect your agent to save personal data.' }
  }

  try {
    const res = await fetch(`${A2A_AGENT_URL}/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${a2aSessionToken}`,
      },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.error ?? `Profile update failed: ${res.statusText}` }
    }

    const result = await res.json()
    return { success: true, profile: result.profile ?? result }
  } catch (e) {
    return { success: false, error: `A2A agent unreachable: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/**
 * Load profile through the delegation chain:
 * Web → A2A agent → Person MCP
 */
export async function loadProfileViaDelegation(
  a2aSessionToken: string | null,
): Promise<{ success: boolean; error?: string; profile?: unknown }> {
  await requireSession()

  if (!a2aSessionToken) {
    return { success: false, error: 'No A2A session' }
  }

  try {
    const res = await fetch(`${A2A_AGENT_URL}/profile`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${a2aSessionToken}` },
    })

    if (!res.ok) return { success: false, error: 'Profile fetch failed' }
    const data = await res.json()
    // A2A returns { profile: { ... } } — unwrap
    return { success: true, profile: data.profile ?? data }
  } catch {
    return { success: false, error: 'A2A agent unreachable' }
  }
}
