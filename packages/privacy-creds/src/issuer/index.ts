/**
 * IssuerAgent — shared core used by apps/org-mcp and apps/family-mcp.
 *
 * An issuer owns:
 *   - a did:ethr identifier + its EOA private key (for on-chain registration
 *     and for signing the publish* txs).
 *   - a set of (schemaId, credDefId) pairs that live on-chain in the
 *     CredentialRegistry contract.
 *
 * The on-chain contract is the source of truth for schema / credDef public
 * records. The issuer's local SQLite only stores:
 *   - CredentialDefinitionPrivate material (issuer-only, never leaves process)
 *   - KeyCorrectnessProof (needed to build credential offers; cheap to cache)
 *
 * IssuerAgent.ensureSchemaAndCredDef publishes to chain, then caches the
 * private bits locally. Idempotent: a second call against already-published
 * ids is a no-op once the local cache is warmed.
 */

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  createWalletClient,
  http,
  stringToHex,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { PrivateKeyAccount as AccountType } from 'viem'
import {
  issuerCreateSchema,
  issuerCreateCredDef,
  issuerCreateCredentialOffer,
  issuerCreateCredential,
} from '../formats/anoncreds-v1/index'
import {
  OnChainResolver,
  credentialRegistryAbi,
  canonicalJsonHash,
  loadVerifiedSchema,
  loadVerifiedCredDef,
} from '@smart-agent/credential-registry'

export interface IssuerAgentConfig {
  /** did:ethr:<chainId>:<address>. Address must be derivable from privateKey. */
  did: string
  /** 0x-prefixed secp256k1 private key. */
  privateKey: `0x${string}`
  /** Human-readable display name — emitted only in logs. */
  displayName: string
  /** RPC URL of the chain holding CredentialRegistry. */
  rpcUrl: string
  /** Chain id the RPC is on. */
  chainId: number
  /** Optional viem chain object (for wallet/public client). */
  chain?: Chain
  /** Address of CredentialRegistry on that chain. */
  credentialRegistryAddress: Address
  /** Local sqlite for credDef-private + KCP caches. */
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
  private readonly resolver: OnChainResolver
  private readonly wallet: WalletClient
  private readonly publicClient: PublicClient
  private readonly privateDb: Database.Database

  constructor(readonly cfg: IssuerAgentConfig) {
    this.account = privateKeyToAccount(cfg.privateKey) as AccountType
    const didAddr = cfg.did.split(':').pop() ?? ''
    if (didAddr.toLowerCase() !== this.account.address.toLowerCase()) {
      throw new Error(`IssuerAgent: DID (${cfg.did}) does not match private key address (${this.account.address})`)
    }
    this.resolver = new OnChainResolver({
      rpcUrl: cfg.rpcUrl,
      chainId: cfg.chainId,
      chain: cfg.chain,
      contractAddress: cfg.credentialRegistryAddress,
    })
    this.wallet = createWalletClient({
      account: this.account,
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    })
    // The resolver already owns a PublicClient; pull one out via a local import
    // so we don't create a second HTTP transport just for writes.
    this.publicClient = (this.resolver as unknown as { client: PublicClient }).client

    mkdirSync(dirname(cfg.privateStorePath), { recursive: true })
    this.privateDb = new Database(cfg.privateStorePath)
    this.privateDb.pragma('journal_mode = WAL')
    this.privateDb.exec(`
      CREATE TABLE IF NOT EXISTS issuer_private (
        credential_definition_id TEXT PRIMARY KEY,
        private_json TEXT NOT NULL,
        key_correctness_proof TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
  }

  /** The on-chain resolver this agent reads through. Exposed so callers
   *  (e.g. MCP servers) can hand the same resolver to other subsystems. */
  getResolver(): OnChainResolver {
    return this.resolver
  }

  /** Publish issuer registration on-chain, if not already registered.
   *  Must run before any publishSchema / publishCredDef. */
  async ensureIssuerRegistered(): Promise<void> {
    const existing = await this.resolver.resolveIssuer(this.account.address)
    if (existing) {
      if (existing.did.toLowerCase() !== this.cfg.did.toLowerCase()) {
        throw new Error(
          `issuer address ${this.account.address} already registered under a different DID (${existing.did})`,
        )
      }
      return
    }
    const hash = await this.wallet.writeContract({
      account: this.account,
      chain: this.cfg.chain ?? null,
      address: this.cfg.credentialRegistryAddress,
      abi: credentialRegistryAbi,
      functionName: 'registerIssuer',
      args: [this.cfg.did, this.account.address],
    })
    await this.publicClient.waitForTransactionReceipt({ hash })
  }

  /** Publish schema + credDef on-chain. Cache the private material locally.
   *  Idempotent: no-op once both ids are published AND the KCP is cached. */
  async ensureSchemaAndCredDef(spec: CredentialSchemaSpec): Promise<void> {
    await this.ensureIssuerRegistered()

    // ── Schema ───
    let schemaJson: string
    if (await this.resolver.isSchemaPublished(spec.schemaId)) {
      const rec = await loadVerifiedSchema(this.resolver, spec.schemaId)
      schemaJson = rec.json
    } else {
      schemaJson = issuerCreateSchema({
        name: spec.name,
        version: spec.version,
        attributeNames: spec.attributeNames,
        issuerId: this.cfg.did,
      })
      const hash = await this.wallet.writeContract({
        account: this.account,
        chain: this.cfg.chain ?? null,
        address: this.cfg.credentialRegistryAddress,
        abi: credentialRegistryAbi,
        functionName: 'publishSchema',
        args: [spec.schemaId, stringToHex(schemaJson)],
      })
      await this.publicClient.waitForTransactionReceipt({ hash })
      // Sanity: on-chain hash must equal what we locally hashed.
      const onChainHash = await this.publicClient.readContract({
        address: this.cfg.credentialRegistryAddress,
        abi: credentialRegistryAbi,
        functionName: 'schemaJsonHash',
        args: [spec.schemaId],
      }) as `0x${string}`
      const expected = canonicalJsonHash(schemaJson)
      if (onChainHash.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`on-chain schema hash mismatch after publish (${spec.schemaId})`)
      }
    }

    // ── CredDef ───
    const cachedPriv = this.getCachedPrivate(spec.credDefId)
    const alreadyPublished = await this.resolver.isCredDefPublished(spec.credDefId)
    if (alreadyPublished && cachedPriv) return

    if (!alreadyPublished) {
      const { credentialDefinition, credentialDefinitionPrivate, keyCorrectnessProof } =
        issuerCreateCredDef({
          schemaJson,
          schemaId: spec.schemaId,
          issuerId: this.cfg.did,
          tag: spec.tag ?? 'v1',
          supportRevocation: spec.supportRevocation ?? false,
        })
      const hash = await this.wallet.writeContract({
        account: this.account,
        chain: this.cfg.chain ?? null,
        address: this.cfg.credentialRegistryAddress,
        abi: credentialRegistryAbi,
        functionName: 'publishCredDef',
        args: [spec.credDefId, spec.schemaId, stringToHex(credentialDefinition)],
      })
      await this.publicClient.waitForTransactionReceipt({ hash })
      this.storePrivate(spec.credDefId, credentialDefinitionPrivate, keyCorrectnessProof)
    } else if (!cachedPriv) {
      // Already on-chain from a prior process but our local cache is gone.
      // We cannot rebuild CredentialDefinitionPrivate from the public record,
      // so surface a clear error rather than silently letting issuance break.
      throw new Error(
        `credDef ${spec.credDefId} is on-chain but issuer private material is missing locally — wipe and re-publish`,
      )
    }
  }

  /** Create a credential offer for a given credDefId (read credDef from chain). */
  async createOffer(credDefId: string): Promise<string> {
    const credDef = await loadVerifiedCredDef(this.resolver, credDefId)
    const cached = this.getCachedPrivate(credDefId)
    if (!cached) {
      throw new Error(`issuer key-correctness-proof missing for ${credDefId}`)
    }
    return issuerCreateCredentialOffer({
      schemaId: credDef.schemaId,
      credentialDefinitionId: credDefId,
      keyCorrectnessProofJson: cached.keyCorrectnessProof,
    })
  }

  /** Finalise an issuance by signing the AnonCreds credential for a holder. */
  async issue(
    credDefId: string,
    credentialOfferJson: string,
    credentialRequestJson: string,
    attributes: Record<string, string>,
  ): Promise<string> {
    const credDef = await loadVerifiedCredDef(this.resolver, credDefId)
    const cached = this.getCachedPrivate(credDefId)
    if (!cached) throw new Error(`issuer private material missing for ${credDefId}`)
    return issuerCreateCredential({
      credentialOfferJson,
      credentialRequestJson,
      credentialDefinitionJson: credDef.json,
      credentialDefinitionPrivateJson: cached.privateJson,
      attributes,
    })
  }

  close(): void {
    this.privateDb.close()
  }

  // ─── private ──

  private storePrivate(credDefId: string, privateJson: string, keyCorrectnessProof: string): void {
    this.privateDb.prepare(
      `INSERT INTO issuer_private (credential_definition_id, private_json, key_correctness_proof, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(credential_definition_id) DO NOTHING`,
    ).run(credDefId, privateJson, keyCorrectnessProof, new Date().toISOString())
  }

  private getCachedPrivate(credDefId: string): { privateJson: string; keyCorrectnessProof: string } | null {
    const row = this.privateDb.prepare(
      `SELECT private_json, key_correctness_proof FROM issuer_private WHERE credential_definition_id = ?`,
    ).get(credDefId) as { private_json: string; key_correctness_proof: string } | undefined
    if (!row) return null
    return { privateJson: row.private_json, keyCorrectnessProof: row.key_correctness_proof }
  }
}
