/**
 * IssuerAgent — shared core used by the mock, apps/org-mcp, and apps/family-mcp.
 *
 * An issuer owns:
 *   - a did:ethr identifier + its EOA private key (for EIP-191 signing of
 *     registry records).
 *   - a set of (schemaId, credDefId) pairs backed by the shared registry.
 *
 * Two pieces of state are deliberately private to the issuer process and
 * never written to the shared credential-registry:
 *   - the EOA private key (lives in env or local key file).
 *   - the `CredentialDefinitionPrivate` material — kept in the issuer's own
 *     SQLite so other processes cannot issue on its behalf.
 *
 * The shared credential-registry only receives the signed PUBLIC records:
 *   - Schema JSON + its signature
 *   - CredentialDefinition JSON + its signature + KCP
 *   - Issuer DID and EOA
 */

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { PrivateKeyAccount as AccountType } from 'viem'
import {
  issuerCreateSchema,
  issuerCreateCredDef,
  issuerCreateCredentialOffer,
  issuerCreateCredential,
} from '../formats/anoncreds-v1/index'
import {
  CredentialRegistryStore,
  signRecord,
} from '@smart-agent/credential-registry'

export interface IssuerAgentConfig {
  /** did:ethr:<chainId>:<address>. Address must be derivable from privateKey. */
  did: string
  /** 0x-prefixed secp256k1 private key. */
  privateKey: `0x${string}`
  /** Human-readable display name of the issuer. */
  displayName: string
  /** Path to the shared credential-registry SQLite. */
  registryPath: string
  /** Path to the issuer's PRIVATE sqlite holding credDef private material. */
  privateStorePath: string
}

export interface CredentialSchemaSpec {
  schemaId: string
  credDefId: string
  name: string
  version: string
  attributeNames: string[]
  tag?: string
  supportRevocation?: boolean
}

export class IssuerAgent {
  readonly account: PrivateKeyAccount
  private readonly registry: CredentialRegistryStore
  private readonly privateDb: Database.Database

  constructor(readonly cfg: IssuerAgentConfig) {
    this.account = privateKeyToAccount(cfg.privateKey) as AccountType
    const didAddr = this.cfg.did.split(':').pop() ?? ''
    if (didAddr.toLowerCase() !== this.account.address.toLowerCase()) {
      throw new Error(`IssuerAgent: DID (${this.cfg.did}) does not match private key address (${this.account.address})`)
    }
    this.registry = new CredentialRegistryStore(cfg.registryPath)
    mkdirSync(dirname(cfg.privateStorePath), { recursive: true })
    this.privateDb = new Database(cfg.privateStorePath)
    this.privateDb.pragma('journal_mode = WAL')
    this.privateDb.exec(`
      CREATE TABLE IF NOT EXISTS issuer_private (
        credential_definition_id TEXT PRIMARY KEY,
        private_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)

    this.registry.upsertIssuer({
      id: cfg.did,
      address: this.account.address,
      displayName: cfg.displayName,
      createdAt: new Date().toISOString(),
    })
  }

  /** Register the schema + credential definition in the shared registry,
   *  signing each public record with the issuer's key. Idempotent. */
  async ensureSchemaAndCredDef(spec: CredentialSchemaSpec): Promise<void> {
    if (!this.registry.getSchema(spec.schemaId)) {
      const schemaJson = issuerCreateSchema({
        name: spec.name,
        version: spec.version,
        attributeNames: spec.attributeNames,
        issuerId: this.cfg.did,
      })
      const signature = await signRecord(this.account, 'schema', spec.schemaId, schemaJson)
      this.registry.insertSchema({
        id: spec.schemaId,
        name: spec.name,
        version: spec.version,
        attributeNames: spec.attributeNames,
        issuerId: this.cfg.did,
        json: schemaJson,
        signature,
        createdAt: new Date().toISOString(),
      })
    }

    if (!this.registry.getCredDef(spec.credDefId)) {
      const schema = this.registry.getSchema(spec.schemaId)!
      const { credentialDefinition, credentialDefinitionPrivate, keyCorrectnessProof } =
        issuerCreateCredDef({
          schemaJson: schema.json,
          schemaId: spec.schemaId,
          issuerId: this.cfg.did,
          tag: spec.tag ?? 'v1',
          supportRevocation: spec.supportRevocation ?? false,
        })
      const signature = await signRecord(this.account, 'credDef', spec.credDefId, credentialDefinition)
      this.registry.insertCredDef(
        {
          id: spec.credDefId,
          schemaId: spec.schemaId,
          issuerId: this.cfg.did,
          tag: spec.tag ?? 'v1',
          json: credentialDefinition,
          keyCorrectnessProof,
          supportRevocation: spec.supportRevocation ?? false,
          signature,
          createdAt: new Date().toISOString(),
        },
      )
      this.privateDb.prepare(
        `INSERT INTO issuer_private (credential_definition_id, private_json, created_at)
         VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
      ).run(spec.credDefId, credentialDefinitionPrivate, new Date().toISOString())
    }
  }

  /** Create a credential offer for a given credDefId. */
  createOffer(credDefId: string): string {
    const credDef = this.registry.getCredDef(credDefId)
    if (!credDef) throw new Error(`credDef not found in registry: ${credDefId}`)
    return issuerCreateCredentialOffer({
      schemaId: credDef.schemaId,
      credentialDefinitionId: credDefId,
      keyCorrectnessProofJson: credDef.keyCorrectnessProof,
    })
  }

  /** Finalise an issuance by signing the AnonCreds credential for a holder. */
  issue(
    credDefId: string,
    credentialOfferJson: string,
    credentialRequestJson: string,
    attributes: Record<string, string>,
  ): string {
    const credDef = this.registry.getCredDef(credDefId)
    if (!credDef) throw new Error(`credDef not found in registry: ${credDefId}`)
    const priv = this.privateDb.prepare(
      `SELECT private_json FROM issuer_private WHERE credential_definition_id = ?`,
    ).get(credDefId) as { private_json: string } | undefined
    if (!priv) throw new Error(`issuer private material missing for ${credDefId}`)

    return issuerCreateCredential({
      credentialOfferJson,
      credentialRequestJson,
      credentialDefinitionJson: credDef.json,
      credentialDefinitionPrivateJson: priv.private_json,
      attributes,
    })
  }

  close(): void {
    this.registry.close()
    this.privateDb.close()
  }
}
