/**
 * Unit tests for `createKmsAccount` (KMS migration K4 PR-1 / §6).
 *
 * Strategy: wire the viem `LocalAccount` adapter to the local-secp256k1
 * backend (PR-1's only signer flavour) and assert end-to-end round-trip
 * via viem's `recoverMessageAddress` / `recoverTypedDataAddress` /
 * `parseTransaction`. The recovered address (not the raw signature bytes)
 * is the load-bearing property — low-s normalization may produce a
 * signature that's byte-different from `privateKeyToAccount`'s output yet
 * still recovers to the same address.
 *
 * Shape conformance: assert the returned account is `type: 'local'` with
 * the four sign* methods, so call sites that introspect the account
 * object behave the same.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  type TransactionSerializableLegacy,
  type TransactionSerializableEIP1559,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  createKmsAccount,
  createLocalSecp256k1Signer,
} from '../../key-custody'

const TEST_KEY = ('0x' + 'a1'.repeat(32)) as `0x${string}`

describe('createKmsAccount / LocalAccount shape', () => {
  it('returns a viem LocalAccount with the required surface', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const account = await createKmsAccount(backend)
    assert.equal(account.type, 'local')
    assert.equal(typeof account.address, 'string')
    assert.match(account.address, /^0x[a-fA-F0-9]{40}$/)
    assert.equal(typeof account.signMessage, 'function')
    assert.equal(typeof account.signTypedData, 'function')
    assert.equal(typeof account.signTransaction, 'function')
  })

  it('caches address from a single upfront backend call', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    let getAddrCalls = 0
    const wrapped = {
      signA2AAction: backend.signA2AAction.bind(backend),
      async getSignerAddress() {
        getAddrCalls++
        return backend.getSignerAddress()
      },
    }
    const account = await createKmsAccount(wrapped)
    // signMessage should not call getSignerAddress again
    await account.signMessage({ message: 'x' })
    await account.signMessage({ message: 'y' })
    assert.equal(getAddrCalls, 1, 'getSignerAddress should be called exactly once')
  })

  it('produces the same address as viem.privateKeyToAccount', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const ours = await createKmsAccount(backend)
    const theirs = privateKeyToAccount(TEST_KEY)
    assert.equal(ours.address.toLowerCase(), theirs.address.toLowerCase())
  })
})

describe('createKmsAccount / signMessage (EIP-191) round-trip', () => {
  it('signMessage signature recovers to the account address', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const account = await createKmsAccount(backend)
    const message = 'hello from KMS K4'
    const signature = await account.signMessage({ message })
    const recovered = await recoverMessageAddress({ message, signature })
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
  })

  it('signMessage with raw bytes recovers to the account address', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const account = await createKmsAccount(backend)
    const raw = new Uint8Array(32).fill(0x42)
    const signature = await account.signMessage({ message: { raw: `0x${'42'.repeat(32)}` } })
    const recovered = await recoverMessageAddress({
      message: { raw: `0x${'42'.repeat(32)}` },
      signature,
    })
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
    // raw is intentionally referenced to silence unused; the underlying
    // bytes are encoded in the hex above.
    assert.equal(raw.length, 32)
  })
})

describe('createKmsAccount / signTypedData (EIP-712) round-trip', () => {
  const domain = {
    name: 'KMS K4 test',
    version: '1',
    chainId: 31337,
    verifyingContract: '0x0000000000000000000000000000000000000001' as `0x${string}`,
  }
  const types = {
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
  }
  const message = {
    name: 'Alice',
    wallet: '0xabcdef0000000000000000000000000000000001' as `0x${string}`,
  }

  it('signTypedData signature recovers to the account address', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const account = await createKmsAccount(backend)
    const signature = await account.signTypedData({
      domain,
      types,
      primaryType: 'Person',
      message,
    })
    const recovered = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: 'Person',
      message,
      signature,
    })
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
  })
})

describe('createKmsAccount / signTransaction (EIP-1559 + legacy)', () => {
  it('EIP-1559 transaction signature parses + recovers to the account', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const account = await createKmsAccount(backend)
    const tx: TransactionSerializableEIP1559 = {
      chainId: 31337,
      nonce: 7,
      maxFeePerGas: 100n * 10n ** 9n,
      maxPriorityFeePerGas: 2n * 10n ** 9n,
      gas: 21000n,
      to: '0x0000000000000000000000000000000000000002',
      value: 10n ** 18n,
      data: '0x',
      type: 'eip1559',
    }
    const serialized = (await account.signTransaction(tx)) as `0x02${string}`
    const parsed = parseTransaction(serialized)
    assert.equal(parsed.type, 'eip1559')
    // Recover the signer address from the serialized tx.
    const recovered = await recoverTransactionAddress({
      serializedTransaction: serialized,
    })
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
  })

  it('legacy EIP-155 transaction signature parses + recovers to the account', async () => {
    const backend = createLocalSecp256k1Signer({ A2A_MASTER_PRIVATE_KEY: TEST_KEY })
    const account = await createKmsAccount(backend)
    const tx: TransactionSerializableLegacy = {
      chainId: 31337,
      nonce: 3,
      gasPrice: 50n * 10n ** 9n,
      gas: 21000n,
      to: '0x0000000000000000000000000000000000000003',
      value: 0n,
      data: '0x',
      type: 'legacy',
    }
    // Legacy txs serialize as a branded `0x${string}`. Cast via the
    // unknown intermediate so the test compiles against viem's stricter
    // `Branded<..., 'legacy'>` discriminator.
    const serialized = (await account.signTransaction(tx)) as unknown as Parameters<
      typeof recoverTransactionAddress
    >[0]['serializedTransaction']
    const parsed = parseTransaction(serialized)
    assert.equal(parsed.type, 'legacy')
    const recovered = await recoverTransactionAddress({
      serializedTransaction: serialized,
    })
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase())
  })
})
