import { OnChainResolver } from '@smart-agent/credential-registry'
import { config } from '../config.js'

/** Process-level resolver singleton. Verifier/wallet reads of schema and
 *  credDef records go through this. */
export const resolver = new OnChainResolver({
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  contractAddress: config.credentialRegistryAddress,
})
