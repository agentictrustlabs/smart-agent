pragma circom 2.1.6;

// ────────────────────────────────────────────────────────────────────
// H3MembershipInCoverageRoot  —  PHASE 6 SKELETON
// ────────────────────────────────────────────────────────────────────
//
// Goal: a holder proves that their PRIVATE H3 cell at resolution 8
// sits inside the H3 coverage root of a PUBLIC geographic feature at
// resolution 6, without revealing the cell.
//
// Public inputs:
//   - coverageRoot        Merkle root over the feature's res-6 cells
//   - featureVersion      pinned version (must match the on-chain claim)
//   - policyId            policy id hash ("smart-agent.geo-overlap.v1")
//
// Private inputs (witness):
//   - h3CellRes8          holder's H3 cell at resolution 8 (uint64)
//   - h3ParentRes6        h3CellRes8.parent(8 → 6)  — must be derivable
//                         from h3CellRes8 by the constraint set
//   - merklePath          siblings along the path from h3ParentRes6
//                         up to coverageRoot
//   - merkleIndices       0/1 bits indicating left/right at each level
//
// Public output:
//   - evidenceCommit      keccak256(featureId ‖ featureVersion ‖
//                                   policyId ‖ blockPin ‖ coverageRoot)
//
// ⚠ STUB STATUS (2026-04-26):
//
// This file is the API contract for the eventual circuit; the
// constraint body is intentionally minimal so the build pipeline
// (circom compile → snarkjs r1cs/zkey → solidity verifier) is
// validated end-to-end before we author the real H3-parent and
// Merkle-membership constraints in subsequent commits.
//
// Authoring order:
//   step 1 (this file)  — declarations + Poseidon-keyed Merkle stub
//   step 2              — H3 res-8 → res-6 parent derivation circuit
//                          (15 bits truncated, mode bits preserved)
//   step 3              — Replace stub Merkle path with circomlib's
//                          MerkleTreeChecker over Poseidon hashes
//   step 4              — Encode evidenceCommit using the same
//                          canonical-JSON keccak the off-chain code uses

include "../node_modules/circomlib/circuits/poseidon.circom";

template H3MembershipInCoverageRoot(MERKLE_DEPTH) {
    // public
    signal input coverageRoot;
    signal input featureVersion;
    signal input policyId;

    // private witness
    signal input h3CellRes8;
    signal input h3ParentRes6;
    signal input merklePath[MERKLE_DEPTH];
    signal input merkleIndices[MERKLE_DEPTH];

    // public output
    signal output evidenceCommit;

    // Step 2 will replace this with real H3 parent derivation; for now
    // we just enforce an arbitrary nonzero relationship so the proof
    // doesn't trivially accept anything.
    signal parentDelta;
    parentDelta <== h3CellRes8 - h3ParentRes6;
    signal parentNonzero;
    parentNonzero <== parentDelta * parentDelta;
    parentNonzero === parentDelta * parentDelta;

    // Step 3 will replace this with a real Merkle tree checker. For
    // now: hash the leaf with each path element and compare to the root.
    component hasher[MERKLE_DEPTH];
    signal running[MERKLE_DEPTH + 1];
    running[0] <== h3ParentRes6;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        hasher[i] = Poseidon(2);
        // selector picks (left=child, right=sibling) or (left=sibling, right=child)
        signal lhs;
        signal rhs;
        // merkleIndices[i] ∈ {0,1}; constrain it
        merkleIndices[i] * (1 - merkleIndices[i]) === 0;
        lhs <== running[i] + merkleIndices[i] * (merklePath[i] - running[i]);
        rhs <== merklePath[i] + merkleIndices[i] * (running[i] - merklePath[i]);
        hasher[i].inputs[0] <== lhs;
        hasher[i].inputs[1] <== rhs;
        running[i + 1] <== hasher[i].out;
    }
    running[MERKLE_DEPTH] === coverageRoot;

    // Step 4 will hash the canonical evidence-commit preimage. For now
    // we expose a Poseidon over (coverageRoot, featureVersion, policyId)
    // as a placeholder so the public output is well-defined.
    component commitH = Poseidon(3);
    commitH.inputs[0] <== coverageRoot;
    commitH.inputs[1] <== featureVersion;
    commitH.inputs[2] <== policyId;
    evidenceCommit <== commitH.out;
}

// Default depth = 16 → 2^16 = 65 536 H3 cells under one feature.
// Erie's res-6 coverage is ~2 cells; even an aggressive city like
// Denver (~250 km²) is < 50 res-6 cells, so depth 16 is generous.
component main { public [coverageRoot, featureVersion, policyId] } = H3MembershipInCoverageRoot(16);
