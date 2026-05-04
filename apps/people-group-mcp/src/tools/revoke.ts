/**
 * Atomic revocation (ADR-PG-5).
 *
 *   1. Bump local revocation_epochs row first — in-flight readers between
 *      step 1 and step 2 see a stale epoch and get denied immediately.
 *   2. Submit on-chain DelegationManager.revokeDelegation.
 *   3. If the chain submission fails, ROLL BACK the DB bump.
 *
 * Caller must hold either the org's session (direct) or a delegation that
 * grants self-revocation. Curators cannot revoke other principals' delegations.
 */

import { createWalletClient, createPublicClient, http } from 'viem'
import { foundry } from 'viem/chains'
import { delegationManagerAbi } from '@smart-agent/sdk'
import { config } from '../config.js'
import { requirePrincipal, AuthError } from '../auth/principal-context.js'
import { bumpRevocationEpoch, rollbackRevocationEpoch } from '../auth/revocation.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const revokeTools = {
  revoke_pg_delegation: {
    name: 'revoke_pg_delegation',
    description:
      'Revoke a sponsor-issued delegation. DB-first epoch bump → on-chain '
      + 'DelegationManager.revokeDelegation; rolls back DB if chain submission fails. '
      + 'In-flight readers between steps see the stale epoch and are denied.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        delegationHash: { type: 'string' },
        chainSignerKey: { type: 'string', description: 'Hex private key authorized to call DelegationManager.revokeDelegation as the org owner. Web seeder/UI passes this from server-side wallet store.' },
      },
      required: ['token', 'delegationHash'],
    },
    handler: async (args: {
      token: string
      delegationHash: string
      chainSignerKey?: `0x${string}`
    }) => {
      let principal: string
      try {
        const ctx = await requirePrincipal({
          token: args.token, toolName: 'revoke_pg_delegation', argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      // STEP 1: bump epoch.
      const newEpoch = bumpRevocationEpoch(principal)

      // STEP 2: chain submission.
      if (!args.chainSignerKey) {
        // Without a chain signer the MCP can't submit revoke. We still hold
        // the DB bump (lazy revoke). Caller must complete the on-chain step
        // separately and then call confirm_pg_revocation_chain (TODO Phase 2).
        return mcpText({
          ok: true,
          newEpoch,
          chainSubmitted: false,
          warning: 'Local revocation epoch bumped; chain revoke not submitted (no chainSignerKey). Re-call with chainSignerKey to complete the on-chain step.',
        })
      }

      try {
        const { privateKeyToAccount } = await import('viem/accounts')
        const account = privateKeyToAccount(args.chainSignerKey)
        const wallet = createWalletClient({ account, chain: { ...foundry, id: config.chainId }, transport: http(config.rpcUrl) })
        const pc = createPublicClient({ chain: { ...foundry, id: config.chainId }, transport: http(config.rpcUrl) })
        const hash = await wallet.writeContract({
          address: config.delegationManagerAddress,
          abi: delegationManagerAbi,
          functionName: 'revokeDelegation',
          args: [args.delegationHash as `0x${string}`],
        })
        await pc.waitForTransactionReceipt({ hash })
        return mcpText({ ok: true, newEpoch, chainSubmitted: true, txHash: hash })
      } catch (err) {
        // STEP 3: rollback.
        rollbackRevocationEpoch(principal)
        return mcpText({ ok: false, rolledBack: true, error: err instanceof Error ? err.message : String(err) })
      }
    },
  },
}
