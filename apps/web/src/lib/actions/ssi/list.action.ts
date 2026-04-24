'use server'

import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'
import { AnchorChecker, CredentialRegistryStore, recordDigest } from '@smart-agent/credential-registry'
import { foundry } from 'viem/chains'
import { resolve } from 'node:path'

export interface CredentialRow {
  id: string
  issuerId: string
  schemaId: string
  credDefId: string
  credentialType: string
  receivedAt: string
  status: string
  anchored: boolean | null  // null if anchor checker unavailable
}

export interface AuditRow {
  id: string
  verifierId: string
  purpose: string
  revealedAttrs: string
  predicates: string
  pairwiseHandle: string | null
  holderBindingIncluded: number
  result: string
  createdAt: string
}

const CRED_REGISTRY_PATH = process.env.CREDENTIAL_REGISTRY_DB_PATH
  ?? resolve(process.cwd(), '../ssi-wallet-mcp/credential-registry.db')

export async function walletStatusAction(): Promise<{
  provisioned: boolean
  principal: string
  credentials: CredentialRow[]
  audit: AuditRow[]
  error?: string
}> {
  try {
    const { principal } = await loadSignerForCurrentUser()

    const [list, audit] = await Promise.all([
      person.callTool<{ credentials: Array<{
        id: string; issuerId: string; schemaId: string; credDefId: string;
        credentialType: string; receivedAt: string; status: string;
      }> }>('ssi_list_my_credentials', { principal }),
      person.callTool<{ audit: AuditRow[] }>('ssi_list_proof_audit', { principal, limit: 25 }),
    ])

    // Anchor-check every credential if the on-chain registry is configured.
    const credentials: CredentialRow[] = []
    let anchorChecker: AnchorChecker | null = null
    let store: CredentialRegistryStore | null = null
    try {
      if (ssiConfig.credentialRegistryContract !== '0x0000000000000000000000000000000000000000') {
        anchorChecker = new AnchorChecker({
          rpcUrl: ssiConfig.rpcUrl,
          chain: { ...foundry, id: ssiConfig.chainId },
          contractAddress: ssiConfig.credentialRegistryContract,
          strict: false,
        })
        store = new CredentialRegistryStore(CRED_REGISTRY_PATH)
      }
    } catch { /* registry DB unreachable — skip anchor checks */ }

    for (const c of list.credentials) {
      let anchored: boolean | null = null
      if (anchorChecker && store) {
        try {
          const schemaRec = store.getSchema(c.schemaId)
          const credDefRec = store.getCredDef(c.credDefId)
          if (schemaRec && credDefRec) {
            // Checker computes recordDigest internally; here we just use its helpers.
            void recordDigest
            const okS = await anchorChecker.verifySchema(c.schemaId, schemaRec.json)
            const okC = await anchorChecker.verifyCredDef(c.credDefId, credDefRec.json)
            anchored = okS && okC
          } else {
            anchored = false
          }
        } catch { anchored = false }
      }
      credentials.push({ ...c, anchored })
    }
    store?.close()

    return {
      provisioned: list.credentials.length > 0,
      principal,
      credentials,
      audit: audit.audit,
    }
  } catch (err) {
    return { provisioned: false, principal: '', credentials: [], audit: [], error: (err as Error).message }
  }
}

export async function listHolderWalletAction(): Promise<{ holderWalletId: string | null; error?: string }> {
  try {
    const { principal } = await loadSignerForCurrentUser()
    const list = await person.callTool<{ credentials: Array<{ holderWalletRef: string }> }>(
      'ssi_list_my_credentials', { principal },
    )
    const ref = list.credentials[0]?.holderWalletRef ?? null
    return { holderWalletId: ref }
  } catch (err) {
    return { holderWalletId: null, error: (err as Error).message }
  }
}
