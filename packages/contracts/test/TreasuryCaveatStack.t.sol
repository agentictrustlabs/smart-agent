// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Treasury Phase 2.5 integration test.
 *
 * Composes the full SESSION_DELEGATION caveat stack a steward would
 * present at tranche-disbursement time, and proves:
 *
 *   1. Disbursement REVERTS before the dispute window (`disputeUntil`)
 *      passes, regardless of how good the rest of the proof is.
 *
 *   2. Disbursement ACCEPTS once block.timestamp ≥ disputeUntil AND every
 *      enforcer in the stack passes:
 *        • TimestampEnforcer (lower bound = disputeUntil)
 *        • RoundDecisionWindowEnforcer (post-window + on awarded list)
 *        • PoolMandateEnforcer (kind + geo Merkle proof)
 *        • AllocationLimitEnforcer (per-tranche cap, asset match)
 *        • StewardEligibilityEnforcer (Hats-style at-redeem-time check)
 *        • QuorumEnforcer (Safe-format N-of-M sigs)
 *
 *   3. Removing a steward via `StewardEligibilityRegistry.setSteward(_, _, false)`
 *      AFTER the SESSION_DELEGATION was minted invalidates that steward's
 *      sig at the next redeem. (Hats-style cascade — proves Phase 2's
 *      core "no re-mint on rotation" claim.)
 *
 *   4. The same delegation re-redeemed after a `RoundCanceledAssertion`
 *      can be invalidated by the cancellation guardian if the SESSION
 *      hash is revoked at the DelegationManager level — but that path
 *      is outside this test (it uses the existing DelegationManager unit
 *      tests). We focus on the *caveat* invariants.
 */

import "forge-std/Test.sol";
import "../src/enforcers/TimestampEnforcer.sol";
import "../src/enforcers/RoundDecisionWindowEnforcer.sol";
import "../src/enforcers/AllocationLimitEnforcer.sol";
import "../src/enforcers/PoolMandateEnforcer.sol";
import "../src/enforcers/StewardEligibilityEnforcer.sol";
import "../src/enforcers/QuorumEnforcer.sol";
import "../src/MandateRegistry.sol";
import "../src/StewardEligibilityRegistry.sol";
import "../src/ApprovedHashRegistry.sol";

contract TreasuryCaveatStackTest is Test {
    // Caveat enforcers (deployed once)
    TimestampEnforcer internal timestampE;
    RoundDecisionWindowEnforcer internal windowE;
    AllocationLimitEnforcer internal allocationE;
    PoolMandateEnforcer internal mandateE;
    StewardEligibilityEnforcer internal eligibilityE;
    QuorumEnforcer internal quorumE;

    // Registries
    MandateRegistry internal mandateReg;
    StewardEligibilityRegistry internal stewardReg;
    ApprovedHashRegistry internal approvedHashReg;

    // Pool / mandate setup
    address internal pool = address(0xCAFE);
    address internal usdc = address(0xA11C0);
    bytes32 internal kindLeaf = keccak256("trauma-care");
    bytes32 internal kindSibling = keccak256("HeartLanguageScripture");
    bytes32 internal geoLeaf = keccak256("us/colorado");
    bytes32 internal geoSibling = keccak256("us/wyoming");
    bytes32 internal kindsRoot;
    bytes32 internal geoRoot;

    // Round / awards setup
    bytes32 internal roundId = keccak256("round-q2-2026");
    bytes32 internal proposalA = keccak256("proposal-a");
    bytes32 internal proposalB = keccak256("proposal-b");
    address internal recipientA = address(0xA1);
    address internal recipientB = address(0xB2);
    uint256 internal totalA = 50_000;
    uint256 internal totalB = 25_000;
    bytes32 internal leafA;
    bytes32 internal leafB;
    bytes32 internal awardsRoot;
    bytes32 internal trancheId = keccak256("round-q2-2026/proposal-a/tranche-1");

    // Stewards
    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    uint256 internal carolPk = 0xCA401;
    address internal alice;
    address internal bob;
    address internal carol;

    // Time anchors
    uint256 internal decidedAt;
    uint256 internal disputeUntil;
    uint256 internal sessionExpires;

    // Payload (the message stewards sign)
    bytes32 internal payloadHash;

    function setUp() public {
        // Deploy enforcers + registries.
        timestampE = new TimestampEnforcer();
        windowE = new RoundDecisionWindowEnforcer();
        allocationE = new AllocationLimitEnforcer();
        mandateE = new PoolMandateEnforcer();
        eligibilityE = new StewardEligibilityEnforcer();
        quorumE = new QuorumEnforcer();
        mandateReg = new MandateRegistry();
        stewardReg = new StewardEligibilityRegistry();
        approvedHashReg = new ApprovedHashRegistry();

        // Configure pool mandate (2-leaf tree).
        kindsRoot = _pair(kindLeaf, kindSibling);
        geoRoot = _pair(geoLeaf, geoSibling);
        vm.prank(pool);
        mandateReg.setMandate(pool, kindsRoot, geoRoot);

        // Configure stewards (3-of-3 set, threshold 2).
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
        vm.startPrank(pool);
        stewardReg.setSteward(pool, alice, true);
        stewardReg.setSteward(pool, bob, true);
        stewardReg.setSteward(pool, carol, true);
        stewardReg.setThreshold(pool, 2);
        vm.stopPrank();

        // Build awards Merkle tree.
        leafA = keccak256(abi.encodePacked(proposalA, recipientA, totalA));
        leafB = keccak256(abi.encodePacked(proposalB, recipientB, totalB));
        awardsRoot = _pair(leafA, leafB);

        // Time anchors — decision happens NOW, dispute window 72h.
        decidedAt = block.timestamp;
        disputeUntil = decidedAt + 72 hours;
        sessionExpires = decidedAt + 90 days;

        // Payload is the EIP-712 hash of (roundId, awardsRoot, decidedAt, ...)
        payloadHash = keccak256(abi.encode(roundId, awardsRoot, decidedAt, sessionExpires));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// Pack ECDSA sigs sorted-ascending Safe-style.
    function _packSigs(uint256[] memory pks, bytes32 hash) internal pure returns (bytes memory packed) {
        packed = new bytes(pks.length * 65);
        for (uint256 i; i < pks.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], hash);
            uint256 off = i * 65;
            assembly {
                let dst := add(packed, add(0x20, off))
                mstore(dst, r)
                mstore(add(dst, 0x20), s)
                mstore8(add(dst, 0x40), v)
            }
        }
    }

    /// Build the pks array for alice + bob (or whichever pair) in
    /// ascending-address order so QuorumEnforcer's sort check passes.
    function _aliceBobAscending() internal view returns (uint256[] memory pks, address[] memory addrs) {
        pks = new uint256[](2);
        addrs = new address[](2);
        if (alice < bob) {
            pks[0] = alicePk; pks[1] = bobPk;
            addrs[0] = alice; addrs[1] = bob;
        } else {
            pks[0] = bobPk; pks[1] = alicePk;
            addrs[0] = bob; addrs[1] = alice;
        }
    }

    /// Walk the full caveat stack a SESSION_DELEGATION would carry.
    /// Reverts on any caveat failure; returns silently on success.
    function _runCaveatStack(uint256 disburseAmount) internal {
        // 1. TimestampEnforcer: validAfter = disputeUntil, validUntil = sessionExpires
        timestampE.beforeHook(
            abi.encode(disputeUntil, sessionExpires),
            "",
            bytes32(0), address(0), address(0), usdc, 0, ""
        );

        // 2. RoundDecisionWindowEnforcer
        bytes memory windowTerms = abi.encode(roundId, disputeUntil, awardsRoot);
        bytes32[] memory awardsProof = new bytes32[](1);
        awardsProof[0] = leafB;
        bytes memory windowArgs = abi.encode(proposalA, recipientA, totalA, awardsProof);
        windowE.beforeHook(windowTerms, windowArgs, bytes32(0), address(0), address(0), usdc, 0, "");

        // 3. PoolMandateEnforcer
        bytes memory mandateTerms = abi.encode(pool, address(mandateReg));
        bytes32[] memory kindProof = new bytes32[](1);
        kindProof[0] = kindSibling;
        bytes32[] memory geoProof = new bytes32[](1);
        geoProof[0] = geoSibling;
        bytes memory mandateArgs = abi.encode(kindLeaf, geoLeaf, kindProof, geoProof);
        mandateE.beforeHook(mandateTerms, mandateArgs, bytes32(0), address(0), address(0), usdc, 0, "");

        // 4. AllocationLimitEnforcer
        bytes memory allocationTerms = abi.encode(trancheId, totalA, usdc);
        bytes memory allocationArgs = abi.encode(disburseAmount);
        allocationE.beforeHook(allocationTerms, allocationArgs, bytes32(0), address(0), address(0), usdc, 0, "");

        // 5. StewardEligibilityEnforcer
        (, address[] memory addrs) = _aliceBobAscending();
        bytes memory eligTerms = abi.encode(pool, address(stewardReg));
        bytes memory eligArgs = abi.encode(addrs);
        eligibilityE.beforeHook(eligTerms, eligArgs, bytes32(0), address(0), address(0), usdc, 0, "");

        // 6. QuorumEnforcer
        (uint256[] memory pks, ) = _aliceBobAscending();
        bytes memory packed = _packSigs(pks, payloadHash);
        address[] memory signerSet = new address[](3);
        signerSet[0] = alice;
        signerSet[1] = bob;
        signerSet[2] = carol;
        bytes memory quorumTerms = abi.encode(signerSet, uint8(2), address(approvedHashReg));
        bytes memory quorumArgs = abi.encode(payloadHash, packed);
        quorumE.beforeHook(quorumTerms, quorumArgs, bytes32(0), address(0), address(0), usdc, 0, "");
    }

    // ─── Tests ──────────────────────────────────────────────────────────

    function test_disbursement_reverts_inside_dispute_window() public {
        // Time has not advanced — block.timestamp < disputeUntil.
        vm.warp(decidedAt + 1 hours);
        // Both TimestampEnforcer (lower bound = disputeUntil) AND
        // RoundDecisionWindowEnforcer (TooEarly) reject inside the window.
        // Probe both directly so the failure mode is deterministic.
        vm.expectRevert(TimestampEnforcer.TimestampNotYetValid.selector);
        timestampE.beforeHook(
            abi.encode(disputeUntil, sessionExpires),
            "",
            bytes32(0), address(0), address(0), usdc, 0, ""
        );

        bytes memory windowTerms = abi.encode(roundId, disputeUntil, awardsRoot);
        bytes32[] memory awardsProof = new bytes32[](1);
        awardsProof[0] = leafB;
        bytes memory windowArgs = abi.encode(proposalA, recipientA, totalA, awardsProof);
        vm.expectRevert(
            abi.encodeWithSelector(RoundDecisionWindowEnforcer.TooEarly.selector, block.timestamp, disputeUntil)
        );
        windowE.beforeHook(windowTerms, windowArgs, bytes32(0), address(0), address(0), usdc, 0, "");
    }

    function test_disbursement_passes_after_dispute_window() public {
        // Warp past disputeUntil — every caveat in the stack must pass.
        vm.warp(disputeUntil + 1);
        _runCaveatStack(15_000); // first tranche draw under cap
    }

    function test_steward_removal_invalidates_session_at_redeem_time() public {
        vm.warp(disputeUntil + 1);
        // Pool removes alice's eligibility AFTER the SESSION_DELEGATION
        // would have been minted.
        vm.prank(pool);
        stewardReg.setSteward(pool, alice, false);

        // StewardEligibilityEnforcer rejects on the next redeem.
        (, address[] memory addrs) = _aliceBobAscending();
        bytes memory eligTerms = abi.encode(pool, address(stewardReg));
        bytes memory eligArgs = abi.encode(addrs);
        vm.expectRevert(abi.encodeWithSelector(StewardEligibilityEnforcer.StewardNotEligible.selector, alice));
        eligibilityE.beforeHook(eligTerms, eligArgs, bytes32(0), address(0), address(0), usdc, 0, "");
    }

    function test_tranche_cap_blocks_overdraw() public {
        vm.warp(disputeUntil + 1);
        // First draw: 30k of 50k cap (full caveat stack happy path).
        _runCaveatStack(30_000);
        // Second draw of 25k would push spent to 55k > 50k cap. Probe the
        // AllocationLimitEnforcer directly to bypass other caveats whose
        // state-bearing behavior could mask the cap check.
        bytes memory allocationTerms = abi.encode(trancheId, totalA, usdc);
        bytes memory allocationArgs = abi.encode(uint256(25_000));
        vm.expectRevert(
            abi.encodeWithSelector(AllocationLimitEnforcer.TrancheCapExceeded.selector, uint256(30_000), uint256(50_000), uint256(25_000))
        );
        allocationE.beforeHook(allocationTerms, allocationArgs, bytes32(0), address(0), address(0), usdc, 0, "");
    }

    function test_off_mandate_kind_blocks() public {
        vm.warp(disputeUntil + 1);
        // Configure the round-decision proof correctly but pass a
        // proposal kind that isn't on the mandate's kindsRoot.
        bytes32 badKind = keccak256("crypto-speculation");
        bytes32[] memory kindProof = new bytes32[](1);
        kindProof[0] = kindSibling; // proof against the mandate root that
                                     // doesn't include `badKind`
        bytes32[] memory geoProof = new bytes32[](1);
        geoProof[0] = geoSibling;
        bytes memory mandateArgs = abi.encode(badKind, geoLeaf, kindProof, geoProof);
        bytes memory mandateTerms = abi.encode(pool, address(mandateReg));
        vm.expectRevert(PoolMandateEnforcer.KindNotAccepted.selector);
        mandateE.beforeHook(mandateTerms, mandateArgs, bytes32(0), address(0), address(0), usdc, 0, "");
    }
}
