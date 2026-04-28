import { IssuerAgent, AnonCreds } from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import { privateKeyToAccount } from 'viem/accounts'
import { findCredentialKind } from '@smart-agent/sdk'
import { config } from '../config.js'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

/**
 * SkillsCredential — issuer-signed AnonCreds credential binding a holder
 * to a public skill (`SkillDefinitionRegistry.skillId`) with a relation
 * kind, proficiency score, confidence, and issuer attribution.
 *
 * Held only in the holder vault; skill-mcp never writes to
 * AgentSkillRegistry. The on-chain public claim path uses
 * `mintPublicSkillClaimAction` instead.
 *
 * Attribute set is flat (AnonCreds requirement) and chosen so common
 * verifier predicates work without fetching the SkillRecord row:
 *
 *   skillId          — bytes32 hex of the on-chain SkillDefinition (canonical key)
 *   skillName        — "Grant writing" (human-readable)
 *   relation         — hasSkill | practicesSkill | certifiedIn
 *   proficiencyScore — 0..10000 (predicate-friendly, e.g. ≥ 7000)
 *   confidence       — 0..100
 *   issuerName       — human-readable; bound to issuerDid alsoKnownAs at verify
 *   issuerDid        — DID for cryptographic identity check
 *   validFrom        — unix seconds (predicate: validFrom ≤ now)
 *   validUntil       — unix seconds (predicate: now ≤ validUntil)
 *   issuedAt         — unix seconds the issuer signed
 */

const KIND = findCredentialKind('SkillsCredential')
if (!KIND) throw new Error('SkillsCredential descriptor missing from sdk registry')

export const SKILLS_SCHEMA_ID  = KIND.schemaId
export const SKILLS_CRED_DEF_ID = KIND.credDefId

const address = privateKeyToAccount(config.privateKey).address
export const SKILL_ISSUER_DID = `did:ethr:${config.chainId}:${address.toLowerCase()}`

export const skillIssuer = new IssuerAgent({
  did: SKILL_ISSUER_DID,
  privateKey: config.privateKey,
  displayName: config.displayName,
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  credentialRegistryAddress: config.credentialRegistryAddress,
  privateStorePath: config.privateStorePath,
})

export const SKILLS_SPEC = {
  schemaId: SKILLS_SCHEMA_ID,
  credDefId: SKILLS_CRED_DEF_ID,
  name: 'Skills',
  version: '1.0',
  attributeNames: [...KIND.attributeNames],
}

export async function ensureSkillsRegistered(): Promise<void> {
  await skillIssuer.ensureSchemaAndCredDef(SKILLS_SPEC)
}
