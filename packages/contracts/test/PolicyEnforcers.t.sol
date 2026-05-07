// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/PoolMandateEnforcer.sol";
import "../src/enforcers/RoundDecisionWindowEnforcer.sol";
import "../src/enforcers/AllocationLimitEnforcer.sol";
import "../src/enforcers/StewardEligibilityEnforcer.sol";
import "../src/MandateRegistry.sol";
import "../src/StewardEligibilityRegistry.sol";

/// Helper: standard sorted-pair Merkle proof generation (off-chain shape).
library MerkleHelper {
    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
    /// 2-leaf root.
    function root2(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return pair(a, b);
    }
    /// Proof of `a` against root2(a, b) is just [b].
    function proof2(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }
}

contract PoolMandateEnforcerTest is Test {
    PoolMandateEnforcer internal enf;
    MandateRegistry internal reg;
    address internal pool = address(0xCAFE);

    bytes32 internal kindAccepted = keccak256("trauma-care");
    bytes32 internal kindRejected = keccak256("crypto-speculation");
    bytes32 internal kindSibling  = keccak256("HeartLanguageScripture");
    bytes32 internal geoAccepted  = keccak256("us/colorado");
    bytes32 internal geoSibling   = keccak256("us/wyoming");
    bytes32 internal kindsRoot;
    bytes32 internal geoRoot;

    function setUp() public {
        enf = new PoolMandateEnforcer();
        reg = new MandateRegistry();
        kindsRoot = MerkleHelper.root2(kindAccepted, kindSibling);
        geoRoot = MerkleHelper.root2(geoAccepted, geoSibling);
        vm.prank(pool);
        reg.setMandate(pool, kindsRoot, geoRoot);
    }

    function _terms() internal view returns (bytes memory) {
        return abi.encode(pool, address(reg));
    }

    function _args(bytes32 kindLeaf, bytes32 geoLeaf, bytes32 kindSib, bytes32 geoSib) internal pure returns (bytes memory) {
        bytes32[] memory kp = MerkleHelper.proof2(kindSib);
        bytes32[] memory gp = MerkleHelper.proof2(geoSib);
        return abi.encode(kindLeaf, geoLeaf, kp, gp);
    }

    function test_accepts_proposal_inside_mandate() public view {
        enf.beforeHook(_terms(), _args(kindAccepted, geoAccepted, kindSibling, geoSibling), bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_rejects_proposal_with_unaccepted_kind() public {
        vm.expectRevert(PoolMandateEnforcer.KindNotAccepted.selector);
        enf.beforeHook(_terms(), _args(kindRejected, geoAccepted, kindSibling, geoSibling), bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_rejects_proposal_with_unaccepted_geo() public {
        bytes32 fakeGeo = keccak256("ru/moscow");
        vm.expectRevert(PoolMandateEnforcer.GeoNotAccepted.selector);
        enf.beforeHook(_terms(), _args(kindAccepted, fakeGeo, kindSibling, geoSibling), bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_reverts_if_mandate_unset() public {
        address bareNewPool = address(0xDEAD);
        bytes memory t = abi.encode(bareNewPool, address(reg));
        vm.expectRevert(PoolMandateEnforcer.MandateRootEmpty.selector);
        enf.beforeHook(t, _args(kindAccepted, geoAccepted, kindSibling, geoSibling), bytes32(0), address(0), address(0), address(0), 0, "");
    }
}

contract RoundDecisionWindowEnforcerTest is Test {
    RoundDecisionWindowEnforcer internal enf;
    bytes32 internal roundId = keccak256("round-q2-2026");

    address internal recipient = address(0x1111);
    address internal otherRecipient = address(0x2222);
    bytes32 internal proposalA = keccak256("proposal-a");
    bytes32 internal proposalB = keccak256("proposal-b");
    uint256 internal totalA = 50_000;
    uint256 internal totalB = 25_000;
    bytes32 internal awardsRoot;
    bytes32 internal leafA;
    bytes32 internal leafB;
    uint256 internal disputeUntil;

    function setUp() public {
        enf = new RoundDecisionWindowEnforcer();
        leafA = keccak256(abi.encodePacked(proposalA, recipient, totalA));
        leafB = keccak256(abi.encodePacked(proposalB, otherRecipient, totalB));
        awardsRoot = MerkleHelper.root2(leafA, leafB);
        disputeUntil = block.timestamp + 72 hours;
    }

    function _terms() internal view returns (bytes memory) {
        return abi.encode(roundId, disputeUntil, awardsRoot);
    }

    function _argsA() internal view returns (bytes memory) {
        bytes32[] memory p = MerkleHelper.proof2(leafB);
        return abi.encode(proposalA, recipient, totalA, p);
    }

    function test_reverts_before_dispute_window_passes() public {
        vm.warp(disputeUntil - 1);
        vm.expectRevert(abi.encodeWithSelector(RoundDecisionWindowEnforcer.TooEarly.selector, block.timestamp, disputeUntil));
        enf.beforeHook(_terms(), _argsA(), bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_accepts_after_dispute_window() public {
        vm.warp(disputeUntil);
        enf.beforeHook(_terms(), _argsA(), bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_rejects_recipient_not_in_awards_list() public {
        vm.warp(disputeUntil);
        bytes32[] memory bogusProof = MerkleHelper.proof2(leafB);
        bytes memory args = abi.encode(proposalA, address(0xDEADBEEF), totalA, bogusProof);
        vm.expectRevert(RoundDecisionWindowEnforcer.NotInAwardsList.selector);
        enf.beforeHook(_terms(), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_rejects_amount_tampering() public {
        vm.warp(disputeUntil);
        bytes32[] memory p = MerkleHelper.proof2(leafB);
        bytes memory args = abi.encode(proposalA, recipient, uint256(999_999_999), p); // wrong amount
        vm.expectRevert(RoundDecisionWindowEnforcer.NotInAwardsList.selector);
        enf.beforeHook(_terms(), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }
}

contract AllocationLimitEnforcerTest is Test {
    AllocationLimitEnforcer internal enf;
    address internal usdc = address(0xA11C0);
    bytes32 internal trancheId = keccak256("round/proposalA/tranche1");

    function setUp() public {
        enf = new AllocationLimitEnforcer();
    }

    function _terms(uint256 cap) internal view returns (bytes memory) {
        return abi.encode(trancheId, cap, usdc);
    }

    function _hit(uint256 amount, uint256 cap) internal {
        enf.beforeHook(_terms(cap), abi.encode(amount), bytes32(0), address(0), address(0), usdc, 0, "");
    }

    function test_partial_draws_accumulate_under_cap() public {
        _hit(10_000, 30_000);
        _hit(15_000, 30_000);
        assertEq(enf.trancheSpent(trancheId), 25_000);
    }

    function test_reverts_when_attempt_pushes_over_cap() public {
        _hit(20_000, 30_000);
        vm.expectRevert(abi.encodeWithSelector(AllocationLimitEnforcer.TrancheCapExceeded.selector, uint256(20_000), uint256(30_000), uint256(15_000)));
        _hit(15_000, 30_000);
    }

    function test_rejects_asset_mismatch() public {
        address wrongToken = address(0xBADBAD);
        bytes memory terms = abi.encode(trancheId, uint256(10_000), usdc);
        bytes memory args = abi.encode(uint256(1_000));
        vm.expectRevert(abi.encodeWithSelector(AllocationLimitEnforcer.AssetMismatch.selector, usdc, wrongToken));
        enf.beforeHook(terms, args, bytes32(0), address(0), address(0), wrongToken, 0, "");
    }

    function test_emits_drawn_event() public {
        vm.expectEmit(true, true, false, true);
        emit AllocationLimitEnforcer.TrancheDrawn(trancheId, usdc, 5_000, 5_000, 30_000);
        _hit(5_000, 30_000);
    }
}

contract StewardEligibilityEnforcerTest is Test {
    StewardEligibilityEnforcer internal enf;
    StewardEligibilityRegistry internal reg;
    address internal pool = address(0xCAFE);
    address internal alice = address(0x1111);
    address internal bob = address(0x2222);
    address internal carol = address(0x3333);

    function setUp() public {
        enf = new StewardEligibilityEnforcer();
        reg = new StewardEligibilityRegistry();
        vm.startPrank(pool);
        reg.setSteward(pool, alice, true);
        reg.setSteward(pool, bob, true);
        reg.setSteward(pool, carol, true);
        reg.setThreshold(pool, 2);
        vm.stopPrank();
    }

    function _signers(address[] memory s) internal pure returns (bytes memory) {
        return abi.encode(s);
    }

    function _terms() internal view returns (bytes memory) {
        return abi.encode(pool, address(reg));
    }

    function test_all_eligible_passes() public view {
        address[] memory s = new address[](2);
        s[0] = alice;
        s[1] = bob;
        enf.beforeHook(_terms(), _signers(s), bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_one_ineligible_reverts() public {
        // Remove bob.
        vm.prank(pool);
        reg.setSteward(pool, bob, false);
        address[] memory s = new address[](2);
        s[0] = alice;
        s[1] = bob;
        vm.expectRevert(abi.encodeWithSelector(StewardEligibilityEnforcer.StewardNotEligible.selector, bob));
        enf.beforeHook(_terms(), _signers(s), bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_unknown_signer_reverts() public {
        address random = address(0xDEAD);
        address[] memory s = new address[](1);
        s[0] = random;
        vm.expectRevert(abi.encodeWithSelector(StewardEligibilityEnforcer.StewardNotEligible.selector, random));
        enf.beforeHook(_terms(), _signers(s), bytes32(0), address(0), address(0), address(0), 0, "");
    }
}
