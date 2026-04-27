'use server'

/**
 * Holder-only fetch for a single credential's full attribute values.
 * The `HeldCredentialsPanel` calls this when the user expands a row —
 * person-mcp returns the AnonCreds blob's `values.<name>.raw` map plus
 * the public metadata (issuer/schema/credDef ids, target org, status).
 *
 * The ssi_get_credential_details tool refuses any read where the
 * credential's holder wallet doesn't belong to the calling principal,
 * so the security boundary is `ctx.principal === wallet.personPrincipal`.
 */

import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person } from '@/lib/ssi/clients'

export interface CredentialDetails {
  id: string
  credentialType: string
  issuerId: string
  schemaId: string
  credDefId: string
  receivedAt: string
  status: string
  linkSecretId: string | null
  targetOrgAddress: string | null
  walletContext: string
  holderWalletRef: string
  attributes: Record<string, string>
}

export async function getCredentialDetailsAction(
  credentialId: string,
): Promise<{ success: boolean; credential?: CredentialDetails; error?: string }> {
  try {
    const { principal } = await loadSignerForCurrentUser()
    const res = await person.callTool<{ credential?: CredentialDetails; error?: string }>(
      'ssi_get_credential_details',
      { principal, credentialId },
    )
    if (res.error || !res.credential) {
      return { success: false, error: res.error ?? 'no credential' }
    }
    return { success: true, credential: res.credential }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
