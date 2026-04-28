/**
 * Seed the SkillIssuerRegistry with the demo skill-mcp issuer.
 *
 * v1 demo: registers the apps/skill-mcp issuer EOA (default
 * `0xdd…dd` private key) with wildcard ANY_SKILL authority so the
 * cross-issuance demo (`mintWithEndorsement`) presents a recognized,
 * registry-listed issuer at scoring time.
 *
 * Idempotent: silently skips if the issuer is already registered.
 *
 * Production note. v2 would replace this with a manual admin tool — the
 * curator role is not delegatable in v1, so seeding the registry from a
 * boot script is the only way to get demo data on chain.
 */

import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { skillIssuerRegistryAbi } from '@smart-agent/sdk'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

const DEMO_SKILL_ISSUER_PRIVATE_KEY = (process.env.SKILL_ISSUER_PRIVATE_KEY
  ?? ('0x' + 'd'.repeat(64))) as Hex

/** Wildcard: covers every skillId. Mirrors `ANY_SKILL` from SkillIssuerRegistry. */
const ANY_SKILL: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

export async function seedSkillIssuersOnChain(): Promise<void> {
  const reg = process.env.SKILL_ISSUER_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!reg) {
    console.log('[skill-issuer-seed] SKILL_ISSUER_REGISTRY_ADDRESS not set — skipping')
    return
  }

  const issuer = privateKeyToAccount(DEMO_SKILL_ISSUER_PRIVATE_KEY).address
  const pc = getPublicClient()
  const wc = getWalletClient()

  try {
    const registered = await pc.readContract({
      address: reg, abi: skillIssuerRegistryAbi,
      functionName: 'isRegistered', args: [issuer],
    }) as boolean
    if (registered) {
      console.log(`[skill-issuer-seed] demo issuer ${issuer} already registered`)
      return
    }
  } catch {
    // proceed — read failure shouldn't block first-time setup
  }

  try {
    const hash = await wc.writeContract({
      address: reg,
      abi: skillIssuerRegistryAbi,
      functionName: 'registerIssuer',
      args: [
        issuer,
        'did:smart-agent:demo:skill-mcp',
        9000,                         // 0.9× trust weight (≈ "Anthropic-trusted")
        0n,                            // no stake yet
        'https://smartagent.io/issuer/demo/skill-mcp.json',
        [ANY_SKILL],                   // wildcard authority for the demo
      ],
    })
    await pc.waitForTransactionReceipt({ hash })
    console.log(`[skill-issuer-seed] registered demo issuer ${issuer}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/AlreadyRegistered/i.test(msg)) {
      console.log(`[skill-issuer-seed] demo issuer ${issuer} already registered (race)`)
      return
    }
    console.warn('[skill-issuer-seed] register failed:', msg.slice(0, 200))
  }
}
