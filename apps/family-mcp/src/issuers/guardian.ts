import { IssuerAgent, AnonCreds } from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import { privateKeyToAccount } from 'viem/accounts'
import { config } from '../config.js'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

export const GUARDIAN_SCHEMA_ID  = 'https://family.smartagent.io/schemas/GuardianOfMinor/1.0'
export const GUARDIAN_CRED_DEF_ID = 'https://family.smartagent.io/creddefs/GuardianOfMinor/1.0/v1'

const address = privateKeyToAccount(config.privateKey).address
export const FAMILY_DID = `did:ethr:${config.chainId}:${address}`

export const familyIssuer = new IssuerAgent({
  did: FAMILY_DID,
  privateKey: config.privateKey,
  displayName: config.displayName,
  registryPath: config.registryPath,
  privateStorePath: config.privateStorePath,
})

export const GUARDIAN_SPEC = {
  schemaId: GUARDIAN_SCHEMA_ID,
  credDefId: GUARDIAN_CRED_DEF_ID,
  name: 'GuardianOfMinor',
  version: '1.0',
  // `relationship`: "parent" | "legal-guardian"
  // `minorBirthYear`: year the minor was born (e.g. "2015")
  // `issuedYear`: year credential was issued
  attributeNames: ['relationship', 'minorBirthYear', 'issuedYear'],
}

export async function ensureGuardianRegistered(): Promise<void> {
  await familyIssuer.ensureSchemaAndCredDef(GUARDIAN_SPEC)
}
