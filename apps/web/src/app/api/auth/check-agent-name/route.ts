/**
 * GET /api/auth/check-agent-name?label=richp
 *
 * Lightweight check used by the passkey-signup flow to give the user
 * live feedback before they invoke WebAuthn. Returns availability,
 * format validity, and the predicted counterfactual smart-account
 * address so the UI can show "richp.agent → 0xabc…123" alongside the
 * input.
 */

import { NextResponse } from 'next/server'
import { createPublicClient, http, keccak256, toBytes } from 'viem'
import { localhost } from 'viem/chains'
import {
  agentNameRegistryAbi, agentAccountFactoryAbi,
  namehash,
} from '@smart-agent/sdk'
import { privateKeyToAccount } from 'viem/accounts'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

function isValidLabel(label: string): boolean {
  if (label.length < 1 || label.length > 32) return false
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(label)) return false
  if (label.includes('--')) return false
  return true
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const labelRaw = url.searchParams.get('label') ?? ''
  const label = labelRaw.toLowerCase().trim()
  if (!label) {
    return NextResponse.json({ valid: false, available: false, reason: 'empty' })
  }
  if (!isValidLabel(label)) {
    return NextResponse.json({
      valid: false, available: false,
      reason: 'invalid format — 1–32 chars, lowercase letters/digits/hyphens, no leading/trailing/double hyphens',
    })
  }

  const NAME_REGISTRY = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}` | undefined
  const FACTORY = process.env.AGENT_FACTORY_ADDRESS as `0x${string}` | undefined
  const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
  if (!NAME_REGISTRY || !FACTORY || !DEPLOYER_KEY) {
    return NextResponse.json({ valid: true, available: false, reason: 'registry not configured' }, { status: 500 })
  }

  const fullName = `${label}.agent`
  const node = namehash(fullName) as `0x${string}`
  const client = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

  let exists = false
  try {
    exists = await client.readContract({
      address: NAME_REGISTRY, abi: agentNameRegistryAbi,
      functionName: 'recordExists', args: [node],
    }) as boolean
  } catch (err) {
    return NextResponse.json({ valid: true, available: false, reason: `chain read failed: ${(err as Error).message}` }, { status: 502 })
  }

  // Compute the counterfactual address from the same salt the signup
  // route will use, so the UI can show what address this name will land at.
  const deployer = privateKeyToAccount(DEPLOYER_KEY)
  const salt = BigInt(keccak256(toBytes(fullName)).slice(0, 18))
  let predictedAddress: `0x${string}` | null = null
  try {
    predictedAddress = await client.readContract({
      address: FACTORY, abi: agentAccountFactoryAbi, functionName: 'getAddress',
      args: [deployer.address, salt],
    }) as `0x${string}`
  } catch { /* address preview is best-effort */ }

  return NextResponse.json({
    valid: true,
    available: !exists,
    fullName,
    predictedAddress,
  })
}
