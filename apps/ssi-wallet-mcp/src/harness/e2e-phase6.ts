/**
 * Phase 6 end-to-end.
 *
 * 1. Issuer (Catalyst) registers itself in the on-chain CredentialRegistry.
 * 2. Issuer anchors its schema + credDef hashes on-chain.
 * 3. Wallet-side AnchorChecker reads the anchors and confirms each record's
 *    canonical JSON hashes to the anchored value — authentic.
 * 4. Negative test: we load a record, corrupt one field in the JSON copy
 *    (not in the registry), and confirm the anchor check fails.
 *
 *   Requires:
 *   - anvil running (and deploy-local.sh has deployed CredentialRegistry).
 *   - org-mcp has previously registered its schema + credDef in the off-chain
 *     registry. Trigger by calling POST /credential/offer at least once.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createWalletClient, http } from 'viem'
import { foundry } from 'viem/chains'
import {
  CredentialRegistryStore,
  AnchorChecker,
  credentialRegistryAbi,
  canonicalJson,
  recordDigest,
} from '@smart-agent/credential-registry'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337')
const REGISTRY_PATH = process.env.CREDENTIAL_REGISTRY_PATH ?? '/home/barb/smart-agent/apps/ssi-wallet-mcp/credential-registry.db'
const CR_CONTRACT = (process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
  ?? '0x43E8D89972ba22ed79b84fA2766811c3ca07Ccf3') as `0x${string}`

// Catalyst issuer key (matches org-mcp's config/env; keep in sync).
const CATALYST_PRIV = (process.env.CATALYST_ISSUER_PRIVATE_KEY ?? '0x' + 'c'.repeat(64)) as `0x${string}`

// Deployer funds the issuer for gas on first run (anvil default account 0).
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`

const SCHEMA_ID = 'https://catalyst.noco.org/schemas/OrgMembership/1.0'
const CRED_DEF_ID = 'https://catalyst.noco.org/creddefs/OrgMembership/1.0/v1'

const chain = { ...foundry, id: CHAIN_ID }

async function fundIssuerIfNeeded(issuerAddr: `0x${string}`) {
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
  const balance = await publicClient.getBalance({ address: issuerAddr })
  if (balance > 0n) return
  const deployer = privateKeyToAccount(DEPLOYER_PRIVATE_KEY)
  const wc = createWalletClient({ account: deployer, chain, transport: http(RPC_URL) })
  const hash = await wc.sendTransaction({ to: issuerAddr, value: 10n ** 18n })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function main() {
  console.log('=== Phase 6 end-to-end (on-chain anchor verification) ===')
  console.log('CredentialRegistry contract:', CR_CONTRACT)

  const issuer = privateKeyToAccount(CATALYST_PRIV)
  const did = `did:ethr:${CHAIN_ID}:${issuer.address}`
  console.log('Issuer DID:', did)

  await fundIssuerIfNeeded(issuer.address)

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
  const walletClient = createWalletClient({ account: issuer, chain, transport: http(RPC_URL) })

  // ── Step 1: register issuer on-chain (idempotent) ─────────────────────
  console.log('\n[1] registerIssuer(did, address)')
  const existing = (await publicClient.readContract({
    address: CR_CONTRACT, abi: credentialRegistryAbi,
    functionName: 'getIssuer', args: [did],
  })) as { account: `0x${string}` }
  if (existing.account === '0x0000000000000000000000000000000000000000') {
    const h = await walletClient.writeContract({
      address: CR_CONTRACT, abi: credentialRegistryAbi,
      functionName: 'registerIssuer', args: [did, issuer.address],
    })
    await publicClient.waitForTransactionReceipt({ hash: h })
    console.log('  registered in tx', h)
  } else {
    console.log('  already registered at', existing.account)
  }

  // ── Step 2: load off-chain signed records ────────────────────────────
  console.log('\n[2] load off-chain records from credential-registry')
  const store = new CredentialRegistryStore(REGISTRY_PATH)
  const schema = store.getSchema(SCHEMA_ID)
  const credDef = store.getCredDef(CRED_DEF_ID)
  store.close()
  if (!schema || !credDef) {
    console.error('  off-chain records not found — run org-mcp and trigger /credential/offer first')
    process.exit(1)
  }
  console.log('  schema.sig.length  =', schema.signature.length)
  console.log('  credDef.sig.length =', credDef.signature.length)

  // ── Step 3: anchor schema + credDef hashes on-chain ──────────────────
  console.log('\n[3] anchorSchema / anchorCredDef')
  const schemaHash = recordDigest('schema', schema.id, schema.json)
  const credDefHash = recordDigest('credDef', credDef.id, credDef.json)

  const already = (await publicClient.readContract({
    address: CR_CONTRACT, abi: credentialRegistryAbi,
    functionName: 'getSchemaAnchor', args: [schema.id],
  })) as { issuer: `0x${string}` }
  if (already.issuer === '0x0000000000000000000000000000000000000000') {
    const h1 = await walletClient.writeContract({
      address: CR_CONTRACT, abi: credentialRegistryAbi,
      functionName: 'anchorSchema', args: [schema.id, schemaHash],
    })
    await publicClient.waitForTransactionReceipt({ hash: h1 })
    const h2 = await walletClient.writeContract({
      address: CR_CONTRACT, abi: credentialRegistryAbi,
      functionName: 'anchorCredDef', args: [credDef.id, credDefHash, schema.id],
    })
    await publicClient.waitForTransactionReceipt({ hash: h2 })
    console.log('  schema anchored in', h1)
    console.log('  credDef anchored in', h2)
  } else {
    console.log('  both already anchored — skipping')
  }

  // ── Step 4: verify via AnchorChecker ─────────────────────────────────
  console.log('\n[4] wallet-side AnchorChecker verifies canonical JSON')
  const checker = new AnchorChecker({
    rpcUrl: RPC_URL, chain, contractAddress: CR_CONTRACT,
  })
  const issuerOnChain = await checker.getIssuer(did)
  console.log('  issuer on-chain:', issuerOnChain)

  const schemaOk  = await checker.verifySchema(schema.id, schema.json)
  const credDefOk = await checker.verifyCredDef(credDef.id, credDef.json)
  console.log('  schema anchor matches JSON :', schemaOk)
  console.log('  credDef anchor matches JSON:', credDefOk)

  // ── Step 5: negative test — tampered schema must fail anchor check ───
  console.log('\n[5] negative test: tampered schema should fail')
  const tampered = JSON.parse(schema.json) as Record<string, unknown>
  tampered.attrNames = ['membershipStatus', 'role', 'joinedYear', 'evilExtraField']
  const tamperedJson = canonicalJson(tampered)
  const tamperedOk = await checker.verifySchema(schema.id, tamperedJson)
  console.log('  tampered JSON accepted?:', tamperedOk)

  if (!(schemaOk && credDefOk) || tamperedOk) {
    console.error('❌ Phase 6 failed')
    process.exit(1)
  }
  console.log('\n✅ Phase 6 end-to-end OK')
  console.log('   on-chain CredentialRegistry anchors the canonical JSON of every schema + credDef')
  console.log('   reader refuses tampered records even if the off-chain signature would pass locally')
}

main().catch((err) => { console.error('❌', err); process.exit(1) })
