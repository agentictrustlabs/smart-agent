# @smart-agent/circuits — ZK proofs for geo claims

This workspace owns the **zero-knowledge circuits** that back private
geo-claim matching in the trust-overlap system. The headline circuit is
`GeoH3Inclusion`: a holder proves that their (private) H3
cell at resolution 8 sits under the (public) H3 coverage root of a
geographic feature at resolution 6, **without revealing the cell**.

The circuit's public output equals the `evidenceCommit` field on
`GeoClaimRegistry` claims with `Visibility.PrivateZk`, so the on-chain
verifier can validate proofs in the existing `MatchAgainstPublicGeoSet`
flow without trusting any off-chain process.

## Layout

```
circuits/
├── src/                  Circom source (.circom)
├── build/                Compiled artifacts (r1cs / wasm / sym) — gitignored
├── ptau/                 Powers-of-Tau ceremony files — gitignored, see "Setup"
├── bin/                  Vendored circom compiler binary — gitignored
├── verifier/             Generated Solidity verifier (staged, then copied
│                          to packages/contracts/src/zk/ on export)
└── scripts/              Compile / setup / export pipeline
```

## One-time setup

### 1. Install the circom compiler

Circom v2 is a Rust binary. We don't auto-install it — you should run
this once per dev box:

```bash
# Linux x86_64 (this dev environment)
curl -L https://github.com/iden3/circom/releases/latest/download/circom-linux-amd64 \
  -o circuits/bin/circom \
  && chmod +x circuits/bin/circom

# macOS Apple Silicon
# curl -L https://github.com/iden3/circom/releases/latest/download/circom-macos-arm64 \
#   -o circuits/bin/circom && chmod +x circuits/bin/circom

# Verify
circuits/bin/circom --version
```

If you have Rust installed, `cargo install --git https://github.com/iden3/circom.git`
also works — the binary lands in `~/.cargo/bin/circom` and you can
symlink it into `circuits/bin/`.

### 2. Download the powers-of-tau ceremony file

Groth16 needs a trusted-setup ceremony output. We use the public Hermez
ceremony (multi-party-computed, widely audited). For our circuits we
need at most 2^15 constraints, so `pot15_final.ptau` is the right size.

```bash
pnpm --filter @smart-agent/circuits ptau:download
```

This curls `circuits/ptau/pot15_final.ptau` (~36 MB). It's a one-time
download per dev box; not committed.

### 3. Install snarkjs

```bash
pnpm install --filter @smart-agent/circuits
```

## Build pipeline

```bash
# Compile every .circom → r1cs / wasm / sym
pnpm --filter @smart-agent/circuits compile

# Generate Solidity verifier for a circuit and copy to packages/contracts/
pnpm --filter @smart-agent/circuits verifier geo-h3-inclusion
```

Compiled artifacts live in `build/<circuit-name>/`. The exported Solidity
verifier is committed under `packages/contracts/src/zk/` — that's the
only ZK output that ends up in git.

## Threat model & circuit invariants

The `GeoH3Inclusion` circuit must:
1. **Hide the holder's H3 cell.** Public inputs are only the feature's
   coverage root and the policy / featureVersion identifiers; the cell
   index, parent path, and Merkle siblings are private witnesses.
2. **Bind to the canonical commit.** The public output equals
   `keccak256(canonicalEncoding(featureId, featureVersion, policyId,
   blockPin, h3CoverageRoot))`, matching the `evidenceCommit` field
   stored on `GeoClaimRegistry`.
3. **Reject cell-resolution mismatch.** A claim cell at H3 resolution 8
   must Merkle-path to a coverage cell at resolution 6 via two
   `h3ToParent` hops; the circuit constrains both hops.
4. **Reject revoked feature versions.** Public inputs include
   `featureVersion`; verifiers reject proofs whose version is older than
   the feature's `latestVersion` (post-deactivation).

These invariants are exercised by `scripts/geo-h3-inclusion.test.mjs`
against synthetic Erie/Colorado fixtures — see Phase 6 implementation.
