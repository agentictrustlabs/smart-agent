// Load .env before reading config values
import { readFileSync } from 'fs'
try {
  const envFile = readFileSync('.env', 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx)
      const val = trimmed.slice(eqIdx + 1)
      if (!process.env[key]) process.env[key] = val
    }
  }
} catch { /* .env not found */ }

function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function requireSecret(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required secret: ${key}. The A2A agent will not start without it.`)
  }
  if (value.includes('change-in-production') || value.length < 16) {
    throw new Error(`Weak secret detected for ${key}. Use a strong random value (32+ hex chars).`)
  }
  return value
}

export const config = {
  PORT: parseInt(env('PORT', '3100'), 10),
  RPC_URL: env('RPC_URL', 'http://127.0.0.1:8545'),
  CHAIN_ID: parseInt(env('CHAIN_ID', '31337'), 10),
  A2A_SESSION_SECRET: requireSecret('A2A_SESSION_SECRET'),
  AGENT_ACCOUNT_RESOLVER_ADDRESS: env('AGENT_ACCOUNT_RESOLVER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  DELEGATION_MANAGER_ADDRESS: env('DELEGATION_MANAGER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
  TIMESTAMP_ENFORCER_ADDRESS: env('TIMESTAMP_ENFORCER_ADDRESS', '0x0000000000000000000000000000000000000000') as `0x${string}`,
} as const
