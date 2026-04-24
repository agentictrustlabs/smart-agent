/**
 * Mock coach verifier. Sends a presentation request asking only for a predicate
 * over membershipStatus — i.e. "prove you are a member" without revealing
 * anything else. In Phase 4 this moves to an independent coach agent.
 */

import { Nonce } from '@hyperledger/anoncreds-shared'
import { AnonCreds } from '@smart-agent/privacy-creds'
import { CredentialRegistryStore } from '@smart-agent/credential-registry'
import { MEMBERSHIP_SCHEMA_ID, MEMBERSHIP_CRED_DEF_ID, CATALYST_ISSUER_ID } from './mock-org-issuer.js'

export const COACH_VERIFIER_ID = 'did:ethr:31337:0xc0aC1e0000000000000000000000000000c0aCh1' as const

export function buildCoachPresentationRequest() {
  return {
    name: 'Coach membership check',
    version: '1.0',
    nonce: Nonce.generate(),
    requested_attributes: {
      attr_role: {
        name: 'role',
        restrictions: [{ cred_def_id: MEMBERSHIP_CRED_DEF_ID, issuer_id: CATALYST_ISSUER_ID }],
      },
    } as const,
    requested_predicates: {
      pred_active: {
        name: 'joinedYear',
        p_type: '>=' as const,
        p_value: 2000,                 // trivially true; used to exercise predicate path
        restrictions: [{ cred_def_id: MEMBERSHIP_CRED_DEF_ID }],
      },
    } as const,
  }
}

export function verifyCoachPresentation(
  registryPath: string,
  presentationJson: string,
  presentationRequest: Record<string, unknown>,
): boolean {
  const registry = new CredentialRegistryStore(registryPath)
  try {
    const schema = registry.getSchema(MEMBERSHIP_SCHEMA_ID)!
    const credDef = registry.getCredDef(MEMBERSHIP_CRED_DEF_ID)!
    return AnonCreds.verifierVerifyPresentation({
      presentationJson,
      presentationRequestJson: JSON.stringify(presentationRequest),
      schemasJson: { [MEMBERSHIP_SCHEMA_ID]: schema.json },
      credDefsJson: { [MEMBERSHIP_CRED_DEF_ID]: credDef.json },
    })
  } finally {
    registry.close()
  }
}
