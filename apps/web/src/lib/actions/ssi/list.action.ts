'use server'

import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'
import { OnChainResolver } from '@smart-agent/credential-registry'

export interface CredentialRow {
  id: string
  walletContext: string
  issuerId: string
  schemaId: string
  credDefId: string
  credentialType: string
  receivedAt: string
  status: string
  /** On-chain presence: schema + credDef both published under expected ids. */
  anchored: boolean | null
}

export interface AuditRow {
  id: string
  walletContext: string
  verifierId: string
  purpose: string
  revealedAttrs: string
  predicates: string
  pairwiseHandle: string | null
  holderBindingIncluded: number
  result: string
  createdAt: string
}

export interface WalletSummary {
  id: string
  walletContext: string
  holderWalletRef: string
  status: string
  createdAt: string
}

export async function walletStatusAction(opts: { walletContext?: string } = {}): Promise<{
  principal: string
  activeContext: string
  wallets: WalletSummary[]
  credentials: CredentialRow[]
  audit: AuditRow[]
  error?: string
}> {
  try {
    const { principal } = await loadSignerForCurrentUser()

    const [list, audit, wallets] = await Promise.all([
      person.callTool<{ credentials: CredentialRow[] }>(
        'ssi_list_my_credentials',
        opts.walletContext ? { principal, walletContext: opts.walletContext } : { principal },
      ),
      person.callTool<{ audit: AuditRow[] }>('ssi_list_proof_audit', { principal, limit: 50 }),
      person.callTool<{ wallets: WalletSummary[] }>('ssi_list_wallets', { principal }),
    ])

    // "anchored" = schema + credDef both published on chain under the ids
    //              the credential is minted against. The verifier would
    //              resolve the exact same records at proof time.
    const credentials: CredentialRow[] = []
    let resolver: OnChainResolver | null = null
    if (ssiConfig.credentialRegistryContract !== '0x0000000000000000000000000000000000000000') {
      try {
        resolver = new OnChainResolver({
          rpcUrl: ssiConfig.rpcUrl,
          chainId: ssiConfig.chainId,
          contractAddress: ssiConfig.credentialRegistryContract,
        })
      } catch { /* resolver unavailable — leave anchored null */ }
    }

    for (const c of list.credentials) {
      let anchored: boolean | null = null
      if (resolver) {
        try {
          const [okS, okC] = await Promise.all([
            resolver.isSchemaPublished(c.schemaId),
            resolver.isCredDefPublished(c.credDefId),
          ])
          anchored = okS && okC
        } catch { anchored = false }
      }
      credentials.push({ ...c, anchored })
    }

    const activeContext = opts.walletContext
      ?? wallets.wallets[0]?.walletContext
      ?? 'default'

    return {
      principal,
      activeContext,
      wallets: wallets.wallets,
      credentials,
      audit: audit.audit,
    }
  } catch (err) {
    return {
      principal: '',
      activeContext: 'default',
      wallets: [],
      credentials: [],
      audit: [],
      error: (err as Error).message,
    }
  }
}
