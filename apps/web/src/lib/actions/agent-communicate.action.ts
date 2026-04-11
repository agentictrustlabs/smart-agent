'use server'

import { requireSession } from '@/lib/auth/session'

export interface A2ATaskInput {
  endpoint: string
  taskType: string
  payload: Record<string, unknown>
}

export interface A2ATaskResult {
  success: boolean
  data?: unknown
  error?: string
  statusCode?: number
}

/**
 * Send a task to an agent's A2A endpoint (server-side proxy).
 * The web app calls the agent's HTTP endpoint on behalf of the user.
 */
export async function sendA2ATask(input: A2ATaskInput): Promise<A2ATaskResult> {
  try {
    await requireSession()

    const res = await fetch(`${input.endpoint}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: input.taskType, ...input.payload }),
      signal: AbortSignal.timeout(30000),
    })

    const data = await res.json().catch(() => null)
    return { success: res.ok, data, statusCode: res.status }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Request failed' }
  }
}

/**
 * Fetch an agent's health status via A2A endpoint.
 */
export async function checkA2AHealth(endpoint: string): Promise<A2ATaskResult> {
  try {
    await requireSession()

    const res = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(10000),
    })

    const data = await res.json().catch(() => null)
    return { success: res.ok, data, statusCode: res.status }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Health check failed' }
  }
}

/**
 * Fetch an agent's agent card (capabilities, endpoints).
 */
export async function fetchAgentCard(endpoint: string): Promise<A2ATaskResult> {
  try {
    await requireSession()

    const res = await fetch(`${endpoint}/.well-known/agent.json`, {
      signal: AbortSignal.timeout(10000),
    })

    const data = await res.json().catch(() => null)
    return { success: res.ok, data, statusCode: res.status }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch agent card' }
  }
}
