'use server'

/**
 * Seed Disciple → Coach cross-delegations on-chain.
 *
 * For every COACHING_MENTORSHIP edge, mint a signed cross-delegation that
 * grants the coach read access to a slice of the disciple's person-mcp
 * profile (displayName, email, phone, city, stateProvince, country, language).
 *
 * Delegation shape:
 *   - delegator = disciple's USER smart account
 *   - delegate  = coach's    USER smart account
 *   - audience  = urn:mcp:server:person
 *   - signed by the disciple's EOA (legitimate ERC-1271 owner of disciple's
 *     smart account — the user IS consenting to share)
 *   - persisted in a parallel DATA_ACCESS_DELEGATION edge between the two
 *     PERSON AGENTS so the coaching graph remains the lookup key
 *
 * Runtime:
 *   - Web → A2A `/profile/delegated?target=<disciple_PA>&grantee=<coach_PA>`
 *   - A2A reads the edge → extracts the signed delegation
 *   - A2A forwards to person-mcp `get_delegated_profile` with
 *     targetPrincipal = delegation.delegator (= disciple's smart account)
 *   - person-mcp validates the signature via ERC-1271 on the smart account,
 *     filters to the granted fields, returns
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, encodePacked } from 'viem'
import {
  hashDelegation, encodeTimestampTerms, buildCaveat, buildDataScopeCaveat,
  DATA_ACCESS_DELEGATION, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE, ROOT_AUTHORITY,
  agentRelationshipAbi,
} from '@smart-agent/sdk'
import {
  getPublicClient, getWalletClient, createRelationship, confirmRelationship,
} from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const PERSON_AUDIENCE = 'urn:mcp:server:person'

const COACHING_PROFILE_FIELDS = [
  'displayName', 'email', 'phone', 'language',
  'city', 'stateProvince', 'country',
]

export interface CoachingPair {
  /** Disciple's user-id (data owner — signs the delegation) */
  discipleUserId: string
  /** Coach's user-id (delegate — gains read access) */
  coachUserId: string
}

export async function seedCoachingCrossDelegations(pairs: CoachingPair[]): Promise<number> {
  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}` | undefined
  const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}` | undefined
  const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}` | undefined
  if (!delegationManagerAddr || !timestampEnforcerAddr || !relAddr) {
    console.warn('[seed-coach-deleg] missing env (DELEGATION_MANAGER_ADDRESS, TIMESTAMP_ENFORCER_ADDRESS, AGENT_RELATIONSHIP_ADDRESS)')
    return 0
  }

  const publicClient = getPublicClient()
  let created = 0

  for (const { discipleUserId, coachUserId } of pairs) {
    const disciple = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, discipleUserId)).get()
    const coach = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, coachUserId)).get()
    if (!disciple?.smartAccountAddress || !disciple?.privateKey) {
      console.warn(`[seed-coach-deleg] disciple ${discipleUserId} missing smart account or key`)
      continue
    }
    if (!coach?.smartAccountAddress) {
      console.warn(`[seed-coach-deleg] coach ${coachUserId} missing smart account`)
      continue
    }

    const disciplePA = await getPersonAgentForUser(disciple.id)
    const coachPA = await getPersonAgentForUser(coach.id)
    if (!disciplePA || !coachPA) {
      console.warn(`[seed-coach-deleg] missing person agent (disciple=${disciplePA} coach=${coachPA})`)
      continue
    }

    const disciplePALower = disciplePA.toLowerCase() as `0x${string}`
    const coachPALower = coachPA.toLowerCase() as `0x${string}`
    const discipleSA = disciple.smartAccountAddress.toLowerCase() as `0x${string}`
    const coachSA = coach.smartAccountAddress.toLowerCase() as `0x${string}`

    // Idempotency: skip only if an edge already carries OUR signed delegation
    // (delegator = disciple's smart account). A legacy edge keyed by Person
    // Agent addresses can't validate via ERC-1271 (Ana's EOA isn't an owner
    // of paAna's smart account) — overwrite its metadataURI in that case.
    let existingEdgeId: `0x${string}` | null = null
    let needsOverwrite = false
    try {
      const computed = await publicClient.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'computeEdgeId',
        args: [disciplePALower, coachPALower, DATA_ACCESS_DELEGATION as `0x${string}`],
      }) as `0x${string}`
      const exists = await publicClient.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'edgeExists', args: [computed],
      }) as boolean
      if (exists) {
        existingEdgeId = computed
        const edge = await publicClient.readContract({
          address: relAddr, abi: agentRelationshipAbi,
          functionName: 'getEdge', args: [computed],
        }) as { status: number; metadataURI: string }
        if (edge.status >= 2 && edge.status < 5 && edge.metadataURI) {
          try {
            const meta = JSON.parse(edge.metadataURI)
            const existingDelegator = meta?.delegation?.delegator?.toLowerCase()
            if (existingDelegator === discipleSA) {
              continue // already our up-to-date delegation
            }
            needsOverwrite = true
          } catch {
            needsOverwrite = true
          }
        }
      }
    } catch { /* fall through to create */ }

    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 365 * 24 * 60 * 60
    const salt = BigInt(keccak256(encodePacked(
      ['address', 'address', 'string'],
      [discipleSA, coachSA, 'coach-mcp:profile:v1'],
    )))

    const grants = [{
      server: PERSON_AUDIENCE,
      resources: ['profile'],
      fields: COACHING_PROFILE_FIELDS,
    }]

    const caveats = [
      buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt)),
      buildDataScopeCaveat(grants),
    ]

    const delegation = {
      delegator: discipleSA,
      delegate: coachSA,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats,
      salt,
    }
    const delHash = hashDelegation(
      { ...delegation, salt: salt.toString() },
      CHAIN_ID,
      delegationManagerAddr,
    )

    // Disciple signs with their own EOA — they ARE an owner of their
    // smart account (set as initialOwner at deploy time), so ERC-1271
    // validates their signature.
    const signer = privateKeyToAccount(disciple.privateKey as `0x${string}`)
    const signature = await signer.signMessage({ message: { raw: delHash } })

    const signedDelegation = {
      ...delegation,
      salt: salt.toString(),
      signature,
      caveats: caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
    }

    const metadataURI = JSON.stringify({
      delegation: signedDelegation,
      delegationHash: delHash,
      grants,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      audience: PERSON_AUDIENCE,
      kind: 'coaching-profile',
    })

    try {
      if (needsOverwrite && existingEdgeId) {
        // Replace the stale legacy delegation in-place via setMetadataURI.
        // The relationship's createdBy (deployer) is auth'd to update.
        const wc = getWalletClient()
        const pc = publicClient
        const hash = await wc.writeContract({
          address: relAddr, abi: agentRelationshipAbi,
          functionName: 'setMetadataURI',
          args: [existingEdgeId, metadataURI],
        })
        await pc.waitForTransactionReceipt({ hash })
        created++
      } else {
        const edgeId = await createRelationship({
          subject: disciplePALower,
          object: coachPALower,
          relationshipType: DATA_ACCESS_DELEGATION as `0x${string}`,
          roles: [ROLE_DATA_GRANTOR as `0x${string}`, ROLE_DATA_GRANTEE as `0x${string}`],
          metadataURI,
        })
        await confirmRelationship(edgeId)
        created++
      }
    } catch (err) {
      console.warn(`[seed-coach-deleg] edge ${needsOverwrite ? 'update' : 'create'} failed for disciple=${disciplePALower} coach=${coachPALower}:`, (err as Error).message)
    }
  }

  return created
}
