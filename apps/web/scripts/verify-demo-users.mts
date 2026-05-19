import { createPublicClient, http, getAddress } from 'viem'
import { localhost } from 'viem/chains'
import Database from 'better-sqlite3'

const RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
const RPC = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545'

const rpc = createPublicClient({ chain: localhost, transport: http(RPC) })
const RESOLVER_ABI = [
  { type: 'function', name: 'isRegistered', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getProperty', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }, { name: 'key', type: 'string' }], outputs: [{ type: 'string' }] },
] as const

const db = new Database('/home/barb/smart-agent/apps/web/local.db', { readonly: true })
const rows = db.prepare("SELECT id, name, person_agent_address, agent_name FROM local_user_accounts WHERE id IN ('cat-user-001','cat-user-002','cat-user-005')").all() as Array<{id:string;name:string;person_agent_address:string|null;agent_name:string|null}>

console.log('RESOLVER =', RESOLVER)
for (const r of rows) {
  if (!r.person_agent_address) { console.log(`[${r.id}] ${r.name} — NO AGENT ADDR`); continue }
  const addr = getAddress(r.person_agent_address)
  const [reg, primary] = await Promise.all([
    rpc.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: 'isRegistered', args: [addr] }),
    rpc.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: 'getProperty', args: [addr, 'ATL_PRIMARY_NAME'] }),
  ])
  const code = await rpc.getCode({ address: addr })
  console.log(`[${r.id}] ${r.name}  agent_name=${JSON.stringify(r.agent_name)}`)
  console.log(`   addr        ${addr}`)
  console.log(`   registered  ${reg}`)
  console.log(`   primaryName ${JSON.stringify(primary)}`)
  console.log(`   codeSize    ${code ? code.length / 2 - 1 : 0}`)
}
