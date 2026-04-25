'use server'

/**
 * List the current user's registered passkeys by walking PasskeyAdded/Removed
 * events from their smart account. We don't store extra off-chain state —
 * event logs are the source of truth, with local labels as an optional
 * client-side augmentation (stored in the user's browser).
 */

import {
  createPublicClient,
  http,
  getAddress,
  parseEventLogs,
} from 'viem'
import { localhost } from 'viem/chains'
import { agentAccountAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export interface RegisteredPasskey {
  credentialIdDigest: `0x${string}`
  pubKeyX: string
  pubKeyY: string
  blockNumber: string
  transactionHash: `0x${string}`
}

export interface ListPasskeysResult {
  accountAddress: `0x${string}` | null
  accountDeployed: boolean
  passkeys: RegisteredPasskey[]
  error?: string
}

export async function listPasskeysAction(): Promise<ListPasskeysResult> {
  try {
    const { userRow } = await loadSignerForCurrentUser()
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, userRow.id)).limit(1)
    const smartAcct = rows[0]?.smartAccountAddress
    if (!smartAcct) return { accountAddress: null, accountDeployed: false, passkeys: [], error: 'no smart account address on user row' }
    const accountAddr = getAddress(smartAcct as `0x${string}`)
    const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

    const code = await publicClient.getCode({ address: accountAddr })
    if (!code || code === '0x') {
      return { accountAddress: accountAddr, accountDeployed: false, passkeys: [] }
    }

    const [addedRaw, removedRaw] = await Promise.all([
      publicClient.getLogs({
        address: accountAddr,
        event: agentAccountAbi.find(e => e.type === 'event' && e.name === 'PasskeyAdded') as never,
        fromBlock: 0n,
        toBlock: 'latest',
      }),
      publicClient.getLogs({
        address: accountAddr,
        event: agentAccountAbi.find(e => e.type === 'event' && e.name === 'PasskeyRemoved') as never,
        fromBlock: 0n,
        toBlock: 'latest',
      }),
    ])
    const added = parseEventLogs({ abi: agentAccountAbi, eventName: 'PasskeyAdded',   logs: addedRaw   })
    const removed = parseEventLogs({ abi: agentAccountAbi, eventName: 'PasskeyRemoved', logs: removedRaw })

    const removedSet = new Set(removed.map(l => (l.args as { credentialIdDigest: `0x${string}` }).credentialIdDigest))
    const passkeys: RegisteredPasskey[] = added
      .filter(l => !removedSet.has((l.args as { credentialIdDigest: `0x${string}` }).credentialIdDigest))
      .map(l => {
        const a = l.args as { credentialIdDigest: `0x${string}`; x: bigint; y: bigint }
        return {
          credentialIdDigest: a.credentialIdDigest,
          pubKeyX: a.x.toString(),
          pubKeyY: a.y.toString(),
          blockNumber: l.blockNumber.toString(),
          transactionHash: l.transactionHash,
        }
      })

    return { accountAddress: accountAddr, accountDeployed: true, passkeys }
  } catch (err) {
    return { accountAddress: null, accountDeployed: false, passkeys: [], error: (err as Error).message }
  }
}
