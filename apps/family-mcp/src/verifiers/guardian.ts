import { Nonce } from '@hyperledger/anoncreds-shared'
import { AnonCreds } from '@smart-agent/privacy-creds'
import {
  CredentialRegistryStore,
  loadVerifiedSchema,
  loadVerifiedCredDef,
} from '@smart-agent/credential-registry'
import { GUARDIAN_SCHEMA_ID, GUARDIAN_CRED_DEF_ID, FAMILY_DID } from '../issuers/guardian.js'

/**
 * Build a presentation request that asks:
 *   "Prove you are a current guardian of a minor (minor born after 2006)".
 * No disclosure of name, relationship, or specific year.
 */
export function buildGuardianProofRequest() {
  return {
    name: 'Guardian check',
    version: '1.0',
    nonce: Nonce.generate(),
    requested_attributes: {
      // Optional holder self-attested slot — wallet fills with pairwise handle.
      attr_holder: { name: 'holder' },
    },
    requested_predicates: {
      pred_guardian: {
        name: 'minorBirthYear',
        p_type: '>=' as const,
        p_value: 2006,
        restrictions: [{ cred_def_id: GUARDIAN_CRED_DEF_ID, issuer_id: FAMILY_DID }],
      },
    },
  } as const
}

export async function verifyGuardianPresentation(
  registryPath: string,
  presentationJson: string,
  presentationRequest: Record<string, unknown>,
): Promise<boolean> {
  const reg = new CredentialRegistryStore(registryPath)
  try {
    const schema = await loadVerifiedSchema(reg, GUARDIAN_SCHEMA_ID)
    const credDef = await loadVerifiedCredDef(reg, GUARDIAN_CRED_DEF_ID)
    return AnonCreds.verifierVerifyPresentation({
      presentationJson,
      presentationRequestJson: JSON.stringify(presentationRequest),
      schemasJson: { [GUARDIAN_SCHEMA_ID]: schema.json },
      credDefsJson: { [GUARDIAN_CRED_DEF_ID]: credDef.json },
    })
  } finally {
    reg.close()
  }
}
