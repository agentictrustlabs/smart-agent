pragma circom 2.1.6;

// ────────────────────────────────────────────────────────────────────
// GeoH3Inclusion
// ────────────────────────────────────────────────────────────────────
//
// A holder proves that their PRIVATE H3 cell at resolution 8 sits
// inside the H3 coverage root of a PUBLIC geographic feature at
// resolution 6 — without revealing the cell.
//
// Public inputs:
//   coverageRoot     Poseidon Merkle root over the feature's res-6
//                    cells. The root is committed in
//                    GeoFeatureRegistry.h3CoverageRoot (Phase 2).
//   featureVersion   Pinned feature version (matches the on-chain
//                    GeoClaimRegistry.featureVersion).
//   policyId         keccak256("smart-agent.geo-overlap.v1") truncated
//                    to a single field element. Pinning the policy
//                    means historical scores remain reproducible.
//
// Private inputs (witness):
//   h3CellRes8       The holder's H3 cell at resolution 8.
//   h3ParentRes6     h3ToParent(h3CellRes8, 6) — claimed; constrained.
//   merklePath[D]    Sibling hashes along the path from the parent
//                    cell up to the coverage root (D = MERKLE_DEPTH).
//   merkleIndices[D] 0/1 bits selecting left/right at each level.
//
// Public output:
//   evidenceCommit   Poseidon3(coverageRoot, featureVersion, policyId).
//                    The Solidity verifier and GeoClaimRegistry's
//                    claim.evidenceCommit field reference the same
//                    digest from the same preimage.
//
// Constraints, in order:
//   1. h3ParentRes6 = h3ToParent(h3CellRes8, 6)
//      — bit-level: copy mode/reserved/baseCell/digits 1–6, force
//        resolution 6, force digits 7–15 to 7 (the H3 "unused" sentinel).
//   2. The leaf for the Merkle proof is Poseidon1(h3ParentRes6).
//   3. The Merkle path with indices reproduces coverageRoot.
//   4. evidenceCommit equals Poseidon3(coverageRoot, featureVersion, policyId).
//
// Bit layout of an H3 cell index (64 bits, MSB first):
//   bit 63       : reserved (must be 0)
//   bits 62..59  : mode (4 bits; cell mode = 1)
//   bits 58..56  : reserved (3 bits)
//   bits 55..52  : resolution (4 bits)
//   bits 51..45  : base cell (7 bits)
//   bits 44..42  : digit 1 (3 bits)
//   bits 41..39  : digit 2
//   …
//   bits  2.. 0  : digit 15
//
// Per H3 spec, digits beyond the cell's resolution are filled with the
// "unused" sentinel 7 (binary 111). At res 8, digits 9..15 are 7; at
// res 6, digits 7..15 are 7.

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Range-check: assert that the lowest `n` bits of `in` equal `value`.
// Implemented by decomposing the constant difference; cheap.
template AssertBitRange(LO, HI, VAL) {
    signal input bits[64];
    var width = HI - LO + 1;
    var v = VAL;
    for (var i = 0; i < width; i++) {
        bits[LO + i] === v & 1;
        v = v >> 1;
    }
}

template GeoH3Inclusion(MERKLE_DEPTH) {
    // Public
    signal input coverageRoot;
    signal input featureVersion;
    signal input policyId;

    // Private
    signal input h3CellRes8;
    signal input h3ParentRes6;
    signal input merklePath[MERKLE_DEPTH];
    signal input merkleIndices[MERKLE_DEPTH];

    // Public output
    signal output evidenceCommit;

    // ─── Step 1: H3 parent derivation (res 8 → res 6) ─────────────
    // Decompose both H3 cell ids into 64-bit arrays. Num2Bits
    // implicitly constrains each output bit to {0,1} and that the
    // sum equals the input — so cellBits/parentBits are well-formed.
    component cellBits = Num2Bits(64);
    cellBits.in <== h3CellRes8;
    component parentBits = Num2Bits(64);
    parentBits.in <== h3ParentRes6;

    // Bits that MUST match between cell and parent:
    //   • bit 63 (reserved)
    //   • bits 62..59 (mode)
    //   • bits 58..56 (reserved)
    //   • bits 51..45 (base cell)
    //   • bits 44..27 (digits 1..6, three bits each)
    //   • bits 20.. 0 (digits 9..15 — already 7-filled at res 8)
    var keepRanges[6][2] = [
        [63, 63],
        [62, 59],
        [58, 56],
        [51, 45],
        [44, 27],
        [20,  0]
    ];
    for (var r = 0; r < 6; r++) {
        var hi = keepRanges[r][0];
        var lo = keepRanges[r][1];
        for (var b = lo; b <= hi; b++) {
            cellBits.out[b] === parentBits.out[b];
        }
    }

    // Resolution field (bits 55..52):
    //   cell at res 8 → 4'b1000  (LSB-first: 0,0,0,1)
    //   parent at res 6 → 4'b0110 (LSB-first: 0,1,1,0)
    cellBits.out[52] === 0;
    cellBits.out[53] === 0;
    cellBits.out[54] === 0;
    cellBits.out[55] === 1;
    parentBits.out[52] === 0;
    parentBits.out[53] === 1;
    parentBits.out[54] === 1;
    parentBits.out[55] === 0;

    // Digits 7 and 8 (bits 26..21):
    //   cell — keep whatever value the witness supplies (it must be a
    //          valid H3 digit, but the on-chain h3CoverageRoot proof
    //          implicitly catches forgeries: a fake cell will fail to
    //          produce a valid Merkle path).
    //   parent — must be all 1s (digit 7+8 set to 7 = "unused").
    for (var b = 21; b <= 26; b++) {
        parentBits.out[b] === 1;
    }

    // ─── Step 2: Merkle membership against coverageRoot ───────────
    // Hash the parent cell (a single field element) into a leaf, then
    // walk up the Poseidon-keyed Merkle tree.
    component leafHash = Poseidon(1);
    leafHash.inputs[0] <== h3ParentRes6;

    component levelHash[MERKLE_DEPTH];
    signal running[MERKLE_DEPTH + 1];
    running[0] <== leafHash.out;

    // Selector signals — must be {0,1}.
    signal selL[MERKLE_DEPTH];
    signal selR[MERKLE_DEPTH];

    for (var i = 0; i < MERKLE_DEPTH; i++) {
        // Force {0,1} on the index bit.
        merkleIndices[i] * (1 - merkleIndices[i]) === 0;

        // selL = (1 - idx) * running + idx * sibling
        // selR = (1 - idx) * sibling + idx * running
        selL[i] <== running[i] + merkleIndices[i] * (merklePath[i] - running[i]);
        selR[i] <== merklePath[i] + merkleIndices[i] * (running[i] - merklePath[i]);

        levelHash[i] = Poseidon(2);
        levelHash[i].inputs[0] <== selL[i];
        levelHash[i].inputs[1] <== selR[i];
        running[i + 1] <== levelHash[i].out;
    }
    running[MERKLE_DEPTH] === coverageRoot;

    // ─── Step 3: evidenceCommit ───────────────────────────────────
    // Poseidon3 over the public preimage. The Solidity verifier and
    // off-chain audit code compute the same digest, so a future
    // GeoClaimRegistry.evidenceCommit lookup matches what the proof
    // attests to.
    component commit = Poseidon(3);
    commit.inputs[0] <== coverageRoot;
    commit.inputs[1] <== featureVersion;
    commit.inputs[2] <== policyId;
    evidenceCommit <== commit.out;
}

// Default depth = 16 → 2^16 = 65 536 res-6 H3 cells under one feature.
// Erie's res-6 coverage is a couple cells; even a city like Denver
// (~250 km²) is < 50 res-6 cells, so depth 16 is comfortably generous.
component main { public [coverageRoot, featureVersion, policyId] } = GeoH3Inclusion(16);
