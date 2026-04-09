# TEE Validation Flow

## What is a Trusted Execution Environment (TEE)?

A **Trusted Execution Environment** is a secure, isolated area inside a processor chip that runs code in a way that nobody — not even the server operator, cloud provider, or system administrator — can see or tamper with. Think of it as a locked room inside a computer where code runs and data is processed, and only the code itself has the key.

### Why does this matter for AI agents?

When an AI agent handles sensitive tasks — managing funds, making decisions, processing private data — users need to know:

1. **The right code is running** — not a modified version that steals data
2. **Nobody can peek inside** — the agent's private keys and processing are shielded
3. **The hardware proves it** — cryptographic proof from the chip itself, not just someone's word

### TEE Architectures

| Architecture | Provider | How it works | Code measurement |
|-------------|----------|-------------|-----------------|
| **AWS Nitro Enclaves** | Amazon | Isolated VM within EC2 with no network, disk, or operator access | PCR0 (image), PCR1 (kernel), PCR2 (application) |
| **Intel TDX** | Intel | Hardware-isolated Trust Domain with encrypted memory | MRTD + RTMR0-RTMR3 (boot chain + application) |
| **Intel SGX** | Intel | Application-level enclaves with sealed memory regions | mrEnclave (code identity) + mrSigner (author identity) |
| **AMD SEV-SNP** | AMD | Encrypted VM with Secure Nested Paging | Launch measurement from attestation report |

### What is a "code measurement"?

A code measurement is a **cryptographic hash** of everything running inside the TEE. It's like a fingerprint of the code. If even one byte changes, the measurement changes completely. This means:

- You can **publish your source code** and show that it compiles to a specific measurement
- Anyone can **verify the measurement** against what's running in the TEE
- The TEE hardware **signs the measurement** so it can't be forged

For AWS Nitro, the measurement is `keccak256(PCR0 || PCR1 || PCR2)` — a hash of the enclave image, Linux kernel, and application code combined. For Intel TDX, it's `keccak256(MRTD || RTMR0-3)` — the Trust Domain and its runtime measurements.

## How TEE Validation Works in ERC-8004

The ERC-8004 standard (Trustless Agents) defines three trust models. TEE attestation is one of them:

```
Trust Models:
  1. Reputation     — client feedback signals (ReputationRegistry)
  2. Crypto-Economic — stake-secured re-execution or ZK proofs
  3. TEE Attestation — hardware-backed proof of code integrity (ValidationRegistry)
```

The **ValidationRegistry** in ERC-8004 provides a generic request/response pattern for any type of validation, including TEE:

```
Agent                     ValidationRegistry              TEE Verifier
  │                              │                             │
  │  validationRequest(          │                             │
  │    validator=TEEVerifier,    │                             │
  │    agentId=42,               │                             │
  │    requestURI="ipfs://quote",│                             │
  │    requestHash=keccak256()   │                             │
  │  ) ─────────────────────────>│                             │
  │                              │  emit ValidationRequest ──>│
  │                              │                             │
  │                              │                             │ Verify TEE quote:
  │                              │                             │   1. Check vendor cert chain
  │                              │                             │   2. Extract code measurements
  │                              │                             │   3. Compare with whitelist
  │                              │                             │
  │                              │  validationResponse(        │
  │                              │    requestHash,             │
  │                              │    response=100, // PASS    │
  │                              │    responseURI="ipfs://ev", │
  │                              │    responseHash,            │
  │                              │    tag="tee-onchain"        │
  │                              │  ) <────────────────────────│
  │                              │                             │
  │  getValidationStatus(hash)   │                             │
  │ ────────────────────────────>│                             │
  │  <── {response: 100, ...}    │                             │
```

### Three Verification Approaches

The ERC-8004 community (from the Telegram discussion) identified three ways to verify a TEE quote. Each has different trust assumptions:

#### 1. Direct On-Chain Verification (Highest Trust)

The smart contract verifies the full TEE attestation on-chain.

```
TEE Agent → raw attestation quote → On-Chain Verifier Contract → Registry
```

- **Implementations:**
  - Automata DCAP Verifier (Intel TDX/SGX) — verifies X.509 cert chain + quote on-chain
  - Base Nitro Validator (AWS Nitro) — verifies COSE_Sign1 + X.509 chain on-chain
  - Sparsity POC — supports both, deployed on Base Sepolia

- **Cost:** ~$0.20-0.80 per verification on L2, ~$0.60-2.50 on L1
- **Trust:** Only trust the TEE vendor (Intel/Amazon/AMD) and the verifier contract code
- **Status:** Working implementations exist for Nitro and TDX

#### 2. ZK Proof Verification (Medium Trust)

Verification is done off-chain in a zkVM, producing a proof verified on-chain.

```
TEE Agent → raw quote → Off-Chain zkVM → ZK Proof → On-Chain Verifier → Registry
```

- **Cost:** ~$0.20 across chains
- **Trust:** Trust the ZK circuit + TEE vendor
- **Status:** Automata provides ZK paths for Intel DCAP

#### 3. TEE Oracle / Off-Chain Aggregation (Lower Trust, Simplest)

A separate trusted TEE verifies the quote off-chain and signs the result.

```
TEE Agent → raw quote → Trusted TEE Oracle → Signed result → On-Chain Registry
```

- **Implementation:** Phala dstack verifier — the verifier itself runs in a TEE
- **Cost:** Cheapest (just a signature verification on-chain)
- **Trust:** Trust the oracle TEE + TEE vendor
- **Trade-off:** Most practical for development, but adds a trust dependency

### Key Design Decision from ERC-8004 Community

From the Telegram discussion, the community converged on:

> "Define an **interface**, not a fixed implementation. Allow TEE vendors to provide their own verification mechanism." — h4x3rotab (Phala)

This means the standard defines:
- **What gets verified:** code measurement, TEE architecture, public key
- **How it's stored:** on-chain registry with measurement + architecture + evidence
- **NOT how verification happens:** that's up to the verifier contract implementation

## How It Maps to Smart Agent Trust Fabric

Our trust fabric integrates TEE validation at multiple levels:

```
                    ┌─────────────────────────┐
                    │    Agent Trust Fabric     │
                    └────────────┬──────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼────────┐ ┌──────▼───────┐ ┌───────▼────────┐
    │  Relationship     │ │  Review      │ │  Validation    │
    │  Layer            │ │  Layer       │ │  Layer         │
    │                   │ │              │ │                │
    │  RuntimeAttestation│ │ AgentReview  │ │ AgentValidation│
    │  BuildProvenance  │ │ Record       │ │ Profile        │
    │                   │ │              │ │                │
    │  Roles:           │ │ ERC-8004     │ │ TEE evidence:  │
    │  - runs-in-tee    │ │ aligned      │ │ - teeArch      │
    │  - attested-by    │ │ feedback     │ │ - codeMeasure  │
    │  - verified-by    │ │              │ │ - verifier     │
    │  - controls-runtime│ │             │ │ - evidenceURI  │
    └──────────────────┘ └──────────────┘ └────────────────┘
              │                                    │
              │         ┌──────────────────┐       │
              └────────►│  Issuer Profile  │◄──────┘
                        │  (TEE Verifier)  │
                        │                  │
                        │  type: tee-verifier
                        │  methods:        │
                        │  - tee-onchain   │
                        │  - tee-offchain  │
                        │  - repro-build   │
                        └──────────────────┘
```

### Contract Interactions

#### Step 1: Register TEE Verifier (One-Time Setup)

```solidity
AgentIssuerProfile.registerIssuer(
    verifierAddress,              // TEE verifier agent/contract
    ISSUER_TEE_VERIFIER,          // keccak256("tee-verifier")
    "Automata DCAP Verifier",     // human-readable name
    "On-chain Intel TDX/SGX attestation verifier",
    [VM_TEE_ONCHAIN_VERIFIED],    // supported validation methods
    [RUNTIME_ATTESTATION],        // claim types it can validate
    "ipfs://verifier-metadata"
)
```

#### Step 2: Establish Runtime Relationship

```solidity
// Agent → TEE Runtime (runs-in-tee)
AgentRelationship.createEdge(
    agent,                        // subject: the AI agent
    teeRuntime,                   // object: the TEE environment
    RUNTIME_ATTESTATION,          // relationship type
    [ROLE_RUNS_IN_TEE],          // role
    ""                            // metadata
)

// TEE Runtime → Verifier (attested-by)
AgentRelationship.createEdge(
    teeRuntime,
    verifier,
    RUNTIME_ATTESTATION,
    [ROLE_ATTESTED_BY],
    ""
)
```

#### Step 3: Record TEE Validation

```solidity
AgentValidationProfile.recordValidation(
    assertionId,                  // links to the relationship assertion
    VM_TEE_ONCHAIN_VERIFIED,      // validation method
    verifierContract,             // on-chain verifier address
    TEE_NITRO,                    // keccak256("aws-nitro")
    codeMeasurement,              // keccak256(PCR0 || PCR1 || PCR2)
    "ipfs://attestation-bundle"   // full evidence
)
```

#### Step 4: Query Trust

```solidity
// Check if agent has TEE validation
AgentTrustProfile.checkExecutionTrust(agent)
// → returns TrustResult { passes, score, edgeCount, ... }

// Check specific validations
AgentValidationProfile.getValidationsByValidator(verifier)
// → returns validationId[]
```

## Validation Record Structure

```solidity
struct ValidationRecord {
    uint256 validationId;
    uint256 assertionId;         // which assertion this validates
    bytes32 validationMethod;    // tee-onchain-verified, tee-offchain-aggregated, reproducible-build
    address verifierContract;    // on-chain verifier (0x0 if off-chain)
    bytes32 teeArch;             // aws-nitro, intel-tdx, intel-sgx, amd-sev
    bytes32 codeMeasurement;     // hash of code running in the TEE
    string evidenceURI;          // link to full attestation bundle
    address validatedBy;         // who recorded the validation
    uint256 validatedAt;         // block.timestamp
}
```

### What Goes in evidenceURI

The evidence bundle (typically hosted on IPFS) should contain:

```json
{
  "attestation": {
    "rawQuote": "base64-encoded TEE quote",
    "quoteType": "dcap-v4",
    "teeArch": "intel-tdx"
  },
  "measurements": {
    "MRTD": "0x...",
    "RTMR0": "0x...",
    "RTMR1": "0x...",
    "RTMR2": "0x...",
    "RTMR3": "0x..."
  },
  "buildProvenance": {
    "sourceRepo": "https://github.com/org/agent",
    "commitHash": "abc123...",
    "buildAction": "https://github.com/org/agent/actions/runs/12345",
    "reproducible": true
  },
  "verifier": {
    "contract": "0x...",
    "chain": "base-sepolia",
    "txHash": "0x..."
  }
}
```

## Web App Flow

### Viewing TEE Validations (`/tee`)

The TEE page shows:
1. **Registered TEE Verifiers** — issuers of type `tee-verifier` from AgentIssuerProfile
2. **Validation Records** — all on-chain validation records from AgentValidationProfile
3. **How It Works** — educational content explaining TEE validation

### Recording a Validation (`/tee/submit`)

1. Select the agent to validate
2. Choose TEE architecture (AWS Nitro, Intel TDX, Intel SGX, AMD SEV)
3. Choose validation method (on-chain, off-chain aggregated, reproducible build)
4. Enter the code measurement hash
5. Optionally enter verifier contract address and evidence URI
6. Submit — recorded on-chain via `AgentValidationProfile.recordValidation()`

## Relationship to ERC-8004 ValidationRegistry

Our `AgentValidationProfile` is a purpose-built contract that extends the ERC-8004 ValidationRegistry concept with TEE-specific fields:

| ERC-8004 ValidationRegistry | Smart Agent AgentValidationProfile |
|------------------------------|-------------------------------------|
| `validationRequest()` — generic request | (Not needed — validation is recorded directly) |
| `validationResponse()` — generic 0-100 response | `recordValidation()` — structured TEE evidence |
| `response: uint8` (0-100 pass/fail) | `codeMeasurement: bytes32` (exact code hash) |
| `tag: string` (free-form) | `teeArch: bytes32` + `validationMethod: bytes32` (typed) |
| `responseURI` (generic evidence) | `evidenceURI` + `verifierContract` (typed) |

The key difference: ERC-8004 is intentionally generic (any validation type). Our contract adds TEE-specific structure while remaining compatible with the ERC-8004 flow for interoperability.

## Security Considerations

### What TEE validation proves

- The agent's code **matches a known measurement** at the time of attestation
- The code is running inside **genuine TEE hardware** (verified by the vendor's certificate chain)
- The TEE's memory and execution are **isolated** from the host OS

### What TEE validation does NOT prove

- That the code is **correct or safe** — only that it's the expected code. Code audits are still needed.
- That the code **hasn't changed since attestation** — if the TEE supports hot-reloading or mutable runtimes, the measurement may not reflect current state (flagged by Joshua/Phala in the ERC-8004 discussion)
- That the **TEE vendor is trustworthy** — if Intel/Amazon/AMD have a backdoor, the attestation is meaningless. This is an inherent limitation of all TEE approaches.
- **Protection against physical attacks** — AMD SEV doesn't claim to defend against physical access (noted by Andrew Miller)

### Reproducible builds

For maximum trust, combine TEE attestation with **reproducible builds**:

1. Source code is public on GitHub
2. A deterministic build process produces the exact same binary every time
3. The binary's hash matches the PCR/RTMR measurement in the TEE attestation
4. Anyone can verify by rebuilding from source

This is the approach used by Sparsity's Nova platform and Phala's dstack.

## Future Work

### TEE Key Registry (ERC-8004 v2)

The ERC-8004 community is working on a dedicated TEE Key Registry that:
- Stores `(public_key, code_measurement, tee_vendor)` tuples
- Proves a key was created/used inside a specific TEE
- Enables signature verification: "if you trust Intel + this source code, you can trust signatures from this key"

This is currently under development by Sparsity Labs and Phala, with the goal of:
- Direct on-chain verification for both Nitro (via Base validator) and TDX (via Automata DCAP)
- An `IVerifier` interface that any TEE vendor can implement
- A unified registry that works across TEE architectures

### Integration with ERC-7913

ERC-7913 proposes stateless, reusable verifiers for digital signature algorithms. This could be combined with TEE attestation to deploy standard verifiers for each TEE architecture (SGX, Nitro, TDX) rather than maintaining a separate registry.

### Delegation-Based TEE Validation

Similar to how review submission uses delegation (DelegationManager → agent account → createReview), TEE validation could be delegated:
- TEE verifier has a delegation from the agent
- Verifier calls `recordValidation()` through the agent's account
- Caveats restrict to `recordValidation` only + time-bounded
