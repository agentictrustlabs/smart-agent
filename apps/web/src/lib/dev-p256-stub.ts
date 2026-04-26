/**
 * Mirror the deployed P-256 verifier to the canonical Daimo address.
 *
 * AgentAccount's `P256Verifier` library tries the RIP-7212 precompile at
 * 0x0000…0100 first, then falls back to Daimo's verifier at
 * 0xc2b78104907F722DABAc4C69f826a522B2754De4. Anvil 1.5 doesn't expose
 * RIP-7212 via flags, and `vm.etch` from `Deploy.s.sol` doesn't persist
 * across broadcast — so we deploy the OpenZeppelin-backed verifier as a
 * normal contract (`P256_VERIFIER_ADDRESS` in env) and at boot copy its
 * runtime bytecode to the canonical address with `anvil_setCode`.
 *
 *   ✓ Real cryptographic P-256 verification (no always-true stub).
 *   ✓ Idempotent — skips if the canonical address already has matching bytecode.
 *   ✓ No-op outside dev / non-anvil chains (`anvil_setCode` is dev-only).
 */

const DAIMO_ADDR = '0xc2b78104907F722DABAc4C69f826a522B2754De4'
const RIP7212_ADDR = '0x0000000000000000000000000000000000000100'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!r.ok) return null
    const body = await r.json() as { result?: T; error?: unknown }
    if (body.error) return null
    return (body.result ?? null) as T | null
  } catch {
    return null
  }
}

export async function ensureDevP256Stub(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return

  const verifierAddr = process.env.P256_VERIFIER_ADDRESS
  if (!verifierAddr) return

  // Read the runtime bytecode of the deployed verifier.
  const verifierCode = await rpc<string>('eth_getCode', [verifierAddr, 'latest'])
  if (!verifierCode || verifierCode === '0x') return

  // Skip if the canonical Daimo address already has identical bytecode.
  const existingDaimo = await rpc<string>('eth_getCode', [DAIMO_ADDR, 'latest'])
  if (existingDaimo && existingDaimo.toLowerCase() === verifierCode.toLowerCase()) return

  // Mirror it. anvil_setCode is a no-op on non-anvil chains.
  await rpc<null>('anvil_setCode', [DAIMO_ADDR, verifierCode])

  // RIP-7212 stays empty — the smart account checks the precompile slot
  // first; an empty staticcall returns no result, library moves on to the
  // Daimo address. We don't put anything at 0x0000…0100 unless someone
  // wants the precompile to "answer first" via the always-true stub.
  void RIP7212_ADDR
}
