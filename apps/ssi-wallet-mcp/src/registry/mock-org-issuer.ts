/**
 * Mock OrgMembershipCredential issuer. In Phase 4 this moves to org-mcp.
 *
 * Phase-2 posture:
 *   - the issuer owns a private key (generated or supplied).
 *   - registers its did:ethr + EOA address in the registry.
 *   - signs every schema + credDef public record (EIP-191 over canonical JSON).
 *   - stores private creddef material (issuer secret) in the registry too
 *     (only the mock does this — a real issuer keeps it outside the registry).
 *
 * Readers (wallet, verifier) must use `loadVerifiedSchema` / `loadVerifiedCredDef`
 * from @smart-agent/credential-registry, which re-verifies signatures.
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import type { PrivateKeyAccount } from 'viem'
import { AnonCreds } from '@smart-agent/privacy-creds'
import { CredentialRegistryStore, signRecord } from '@smart-agent/credential-registry'

/** Deterministic dev key so we get a stable issuer EOA across resets. */
const MOCK_ISSUER_PRIVATE_KEY =
  (process.env.CATALYST_ISSUER_PRIVATE_KEY as `0x${string}` | undefined) ??
  ('0x' + 'c'.repeat(64)) as `0x${string}`

const mockIssuerAccount: PrivateKeyAccount = privateKeyToAccount(MOCK_ISSUER_PRIVATE_KEY)
export const CATALYST_ISSUER_ADDRESS = mockIssuerAccount.address
export const CATALYST_ISSUER_ID = `did:ethr:31337:${CATALYST_ISSUER_ADDRESS}` as const

export const MEMBERSHIP_SCHEMA_ID = 'https://catalyst.noco.org/schemas/OrgMembership/1.0'
export const MEMBERSHIP_CRED_DEF_ID = 'https://catalyst.noco.org/creddefs/OrgMembership/1.0/v1'

export interface MembershipAttributes {
  membershipStatus: 'active' | 'inactive' | 'suspended'
  role: string
  joinedYear: string
  circleId: string
}

export interface OrgIssuer {
  ensureSchemaAndCredDef: () => Promise<void>
  createOffer: () => string
  issue: (credentialOfferJson: string, credentialRequestJson: string, attrs: MembershipAttributes) => string
}

export function mockOrgIssuer(registryPath: string, issuerId: string = CATALYST_ISSUER_ID): OrgIssuer {
  const registry = new CredentialRegistryStore(registryPath)

  registry.upsertIssuer({
    id: issuerId,
    address: CATALYST_ISSUER_ADDRESS,
    displayName: 'Catalyst NoCo Network',
    createdAt: new Date().toISOString(),
  })

  async function ensureSchemaAndCredDef(): Promise<void> {
    if (!registry.getSchema(MEMBERSHIP_SCHEMA_ID)) {
      const schemaJson = AnonCreds.issuerCreateSchema({
        name: 'OrgMembership',
        version: '1.0',
        attributeNames: ['membershipStatus', 'role', 'joinedYear', 'circleId'],
        issuerId,
      })
      const signature = await signRecord(mockIssuerAccount, 'schema', MEMBERSHIP_SCHEMA_ID, schemaJson)
      registry.insertSchema({
        id: MEMBERSHIP_SCHEMA_ID,
        name: 'OrgMembership',
        version: '1.0',
        attributeNames: ['membershipStatus', 'role', 'joinedYear', 'circleId'],
        issuerId,
        json: schemaJson,
        signature,
        createdAt: new Date().toISOString(),
      })
    }
    if (!registry.getCredDef(MEMBERSHIP_CRED_DEF_ID)) {
      const schema = registry.getSchema(MEMBERSHIP_SCHEMA_ID)!
      const { credentialDefinition, credentialDefinitionPrivate, keyCorrectnessProof } =
        AnonCreds.issuerCreateCredDef({
          schemaJson: schema.json,
          schemaId: MEMBERSHIP_SCHEMA_ID,
          issuerId,
          tag: 'v1',
          supportRevocation: false,
        })
      const signature = await signRecord(mockIssuerAccount, 'credDef', MEMBERSHIP_CRED_DEF_ID, credentialDefinition)
      registry.insertCredDef(
        {
          id: MEMBERSHIP_CRED_DEF_ID,
          schemaId: MEMBERSHIP_SCHEMA_ID,
          issuerId,
          tag: 'v1',
          json: credentialDefinition,
          keyCorrectnessProof,
          supportRevocation: false,
          signature,
          createdAt: new Date().toISOString(),
        },
        {
          credentialDefinitionId: MEMBERSHIP_CRED_DEF_ID,
          privateJson: credentialDefinitionPrivate,
          createdAt: new Date().toISOString(),
        },
      )
    }
  }

  function createOffer(): string {
    const credDef = registry.getCredDef(MEMBERSHIP_CRED_DEF_ID)
    if (!credDef) throw new Error('issuer not initialized — call ensureSchemaAndCredDef first')
    return AnonCreds.issuerCreateCredentialOffer({
      schemaId: MEMBERSHIP_SCHEMA_ID,
      credentialDefinitionId: MEMBERSHIP_CRED_DEF_ID,
      keyCorrectnessProofJson: credDef.keyCorrectnessProof,
    })
  }

  function issue(
    credentialOfferJson: string,
    credentialRequestJson: string,
    attrs: MembershipAttributes,
  ): string {
    const credDef = registry.getCredDef(MEMBERSHIP_CRED_DEF_ID)!
    const priv = registry.getCredDefPrivate(MEMBERSHIP_CRED_DEF_ID)!
    return AnonCreds.issuerCreateCredential({
      credentialOfferJson,
      credentialRequestJson,
      credentialDefinitionJson: credDef.json,
      credentialDefinitionPrivateJson: priv.privateJson,
      attributes: {
        membershipStatus: attrs.membershipStatus,
        role: attrs.role,
        joinedYear: attrs.joinedYear,
        circleId: attrs.circleId,
      },
    })
  }

  return { ensureSchemaAndCredDef, createOffer, issue }
}

/**
 * Convenience for tamper tests: corrupt the stored schema JSON without
 * updating its signature. Readers that call loadVerifiedSchema must reject.
 */
export function tamperSchemaJson(registryPath: string, schemaId: string): void {
  const registry = new CredentialRegistryStore(registryPath)
  const schema = registry.getSchema(schemaId)
  if (!schema) throw new Error('schema not found')
  const tampered = JSON.parse(schema.json) as Record<string, unknown>
  tampered.name = 'tampered'
  // Write back via raw DB to skip the store's insert-only semantics.
  // (OK to reach into internals here — this is test-only.)
  ;(registry as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } }).db
    .prepare('UPDATE schemas SET json = ? WHERE id = ?')
    .run(JSON.stringify(tampered), schemaId)
  registry.close()
}
