import { IssuerAgent, AnonCreds } from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import { privateKeyToAccount } from 'viem/accounts'
import { config } from '../config.js'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

export const MEMBERSHIP_SCHEMA_ID = 'https://catalyst.noco.org/schemas/OrgMembership/1.0'
export const MEMBERSHIP_CRED_DEF_ID = 'https://catalyst.noco.org/creddefs/OrgMembership/1.0/v1'

const address = privateKeyToAccount(config.privateKey).address
export const CATALYST_DID = `did:ethr:${config.chainId}:${address}`

export const catalystIssuer = new IssuerAgent({
  did: CATALYST_DID,
  privateKey: config.privateKey,
  displayName: config.displayName,
  registryPath: config.registryPath,
  privateStorePath: config.privateStorePath,
})

export const MEMBERSHIP_SPEC = {
  schemaId: MEMBERSHIP_SCHEMA_ID,
  credDefId: MEMBERSHIP_CRED_DEF_ID,
  name: 'OrgMembership',
  version: '1.0',
  attributeNames: ['membershipStatus', 'role', 'joinedYear', 'circleId'],
}

export async function ensureMembershipRegistered(): Promise<void> {
  await catalystIssuer.ensureSchemaAndCredDef(MEMBERSHIP_SPEC)
}
