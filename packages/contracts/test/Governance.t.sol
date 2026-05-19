// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/governance/Governance.sol";

/**
 * @title Governance — Phase A.5 (SC4 § 6) test suite
 * @notice Covers proposal flow, multisig threshold, timelock, emergency
 *         pause, signer rotation, cancellation, and the adversarial
 *         negatives the SC4 spec calls "load-bearing".
 */
contract Target {
    uint256 public value;
    bool public boom;
    function setValue(uint256 v) external { value = v; }
    function detonate() external { boom = true; revert("ka-boom"); }
}

contract GovernanceTest is Test {
    // 5-of-9 fixture matching SC4 § 2 parameters but with a 0-second
    // timelock so we don't have to warp 48h for every positive test.
    // Adversarial tests that require a real timelock use
    // `_deployWithTimelock(MIN)`.
    address[9] internal signers;
    uint256[9] internal keys;
    Governance internal gov;
    Target internal target;

    function setUp() public {
        for (uint256 i = 0; i < 9; i++) {
            keys[i] = uint256(keccak256(abi.encode("gov-signer", i)));
            signers[i] = vm.addr(keys[i]);
        }
        gov = _deploy(0, true);
        target = new Target();
    }

    function _deploy(uint256 timelock, bool allowZero) internal returns (Governance) {
        address[] memory dyn = new address[](9);
        for (uint256 i = 0; i < 9; i++) dyn[i] = signers[i];
        return new Governance(dyn, 5, 9, timelock, allowZero);
    }

    function _propose(Governance g, address tgt, bytes memory data, uint256 byIdx)
        internal returns (bytes32 id)
    {
        vm.prank(signers[byIdx]);
        id = g.propose(Governance.ProposalKind.AdminCall, tgt, data);
    }

    function _approveN(Governance g, bytes32 id, uint256 n, uint256 startIdx) internal {
        // start at startIdx to skip signers who already approved
        for (uint256 i = startIdx; i < startIdx + n; i++) {
            vm.prank(signers[i]);
            g.approve(id);
        }
    }

    // ─── Positive paths ──────────────────────────────────────────────

    function test_constructor_records_all_signers() public view {
        assertEq(gov.signerCount(), 9);
        for (uint256 i = 0; i < 9; i++) {
            assertTrue(gov.isSigner(signers[i]));
        }
        assertEq(gov.threshold(), 5);
        assertEq(gov.maxMembers(), 9);
        assertEq(gov.timelockSeconds(), 0);
        assertTrue(gov.allowZeroTimelock());
    }

    function test_FiveOfNineCanProposeAndExecuteImmediately_DevTimelock() public {
        // Default fixture has 0-second timelock; propose + approve 4 + execute.
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (42)), 0);
        _approveN(gov, id, 4, 1); // signers[1..4] approve, total approvals = 5
        gov.execute(id);
        assertEq(target.value(), 42);
    }

    function test_FiveOfNineCanProposeAndExecuteAfterTimelock() public {
        Governance g = _deploy(48 hours, false);
        Target t = new Target();
        bytes32 id = _propose(g, address(t), abi.encodeCall(Target.setValue, (99)), 0);
        _approveN(g, id, 4, 1);
        vm.warp(block.timestamp + 48 hours);
        g.execute(id);
        assertEq(t.value(), 99);
    }

    function test_AnySignerCanCancel() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (1)), 0);
        vm.prank(signers[3]);
        gov.cancel(id);
        // Executing a cancelled proposal reverts NotQueued.
        vm.expectRevert(Governance.NotQueued.selector);
        gov.execute(id);
    }

    function test_cancelled_proposal_blocks_future_approve() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (1)), 0);
        vm.prank(signers[3]);
        gov.cancel(id);
        vm.prank(signers[1]);
        vm.expectRevert(Governance.NotQueued.selector);
        gov.approve(id);
    }

    function test_SignerChangeFlowsThroughTimelock() public {
        Governance g = _deploy(48 hours, false);
        address newSigner = makeAddr("new-signer");
        bytes32 id;
        vm.prank(signers[0]);
        id = g.propose(
            Governance.ProposalKind.SignerChange,
            address(0),
            abi.encode(signers[8], newSigner) // swap signer #8 out
        );
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(signers[i]);
            g.approve(id);
        }
        vm.warp(block.timestamp + 48 hours);
        g.execute(id);
        assertFalse(g.isSigner(signers[8]));
        assertTrue(g.isSigner(newSigner));
        assertEq(g.signerCount(), 9);
    }

    function test_pure_addition_signer_change() public {
        // Only adds, doesn't remove — but final signerCount must stay <= 9.
        // We need a fixture with fewer initial signers.
        address[] memory init = new address[](5);
        for (uint256 i = 0; i < 5; i++) init[i] = signers[i];
        Governance g = new Governance(init, 3, 9, 0, true);

        address newSigner = makeAddr("added");
        vm.prank(signers[0]);
        bytes32 id = g.propose(
            Governance.ProposalKind.SignerChange,
            address(0),
            abi.encode(address(0), newSigner)
        );
        vm.prank(signers[1]); g.approve(id);
        vm.prank(signers[2]); g.approve(id);
        g.execute(id);
        assertTrue(g.isSigner(newSigner));
        assertEq(g.signerCount(), 6);
    }

    function test_EmergencyPauseBypassesTimelock() public {
        Governance g = _deploy(48 hours, false);
        bytes memory sigs = _signEmergencyPause(g, /* count */ 5, /* nonce */ g.proposalNonce() + 1);
        g.emergencyPause(g.proposalNonce() + 1, sigs);
        assertTrue(g.isPaused());
    }

    function test_UnpauseRequiresFullTimelock() public {
        Governance g = _deploy(48 hours, false);
        // pause first
        bytes memory sigs = _signEmergencyPause(g, 5, g.proposalNonce() + 1);
        g.emergencyPause(g.proposalNonce() + 1, sigs);

        // queue unpause; can't execute before 48h
        vm.prank(signers[0]);
        bytes32 id = g.propose(Governance.ProposalKind.Unpause, address(0), "");
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(signers[i]);
            g.approve(id);
        }
        vm.warp(block.timestamp + 48 hours - 1);
        vm.expectRevert(Governance.NotReady.selector);
        g.execute(id);
        vm.warp(block.timestamp + 1);
        g.execute(id);
        assertFalse(g.isPaused());
    }

    function test_execute_is_permissionless_after_quorum_and_timelock() public {
        // 0-sec timelock fixture — non-signer can pay gas to execute.
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (7)), 0);
        _approveN(gov, id, 4, 1);
        address bystander = makeAddr("bystander");
        vm.prank(bystander);
        gov.execute(id);
        assertEq(target.value(), 7);
    }

    // ─── Negative paths (load-bearing) ───────────────────────────────

    function test_FourSignersCannotExecute() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (1)), 0);
        _approveN(gov, id, 3, 1); // total = 4
        vm.expectRevert(Governance.ThresholdNotMet.selector);
        gov.execute(id);
    }

    function test_ExecuteBeforeTimelockReverts() public {
        Governance g = _deploy(48 hours, false);
        Target t = new Target();
        bytes32 id = _propose(g, address(t), abi.encodeCall(Target.setValue, (1)), 0);
        _approveN(g, id, 4, 1);
        vm.warp(block.timestamp + 48 hours - 1);
        vm.expectRevert(Governance.NotReady.selector);
        g.execute(id);
    }

    function test_NonSignerCannotPropose() public {
        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert(Governance.NotSigner.selector);
        gov.propose(Governance.ProposalKind.AdminCall, address(target), "");
    }

    function test_NonSignerCannotApprove() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (1)), 0);
        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert(Governance.NotSigner.selector);
        gov.approve(id);
    }

    function test_DoubleApproveReverts() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (1)), 0);
        // signers[0] already approved during propose
        vm.prank(signers[0]);
        vm.expectRevert(Governance.AlreadyApproved.selector);
        gov.approve(id);
    }

    function test_CancelledProposalCannotBeExecuted() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (1)), 0);
        _approveN(gov, id, 4, 1); // quorum met
        vm.prank(signers[2]);
        gov.cancel(id);
        vm.expectRevert(Governance.NotQueued.selector);
        gov.execute(id);
    }

    function test_NonSignerCannotCancel() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.setValue, (1)), 0);
        vm.prank(makeAddr("random"));
        vm.expectRevert(Governance.NotSigner.selector);
        gov.cancel(id);
    }

    function test_PauseDoesNotGrantUpgrade() public {
        // emergencyPause sets the flag, nothing else.
        bytes memory sigs = _signEmergencyPause(gov, 5, gov.proposalNonce() + 1);
        gov.emergencyPause(gov.proposalNonce() + 1, sigs);
        // target.value should remain unchanged
        assertEq(target.value(), 0);
        assertTrue(gov.isPaused());
    }

    function test_EmergencyPauseRequiresThresholdSignatures() public {
        uint256 nonce = gov.proposalNonce() + 1;
        bytes memory sigs = _signEmergencyPause(gov, 4, nonce);
        vm.expectRevert(Governance.SignatureCountBelowThreshold.selector);
        gov.emergencyPause(nonce, sigs);
    }

    function test_DuplicateSignaturesDoNotCount() public {
        // 5 signatures where 2 are the same signer (counts as 1 distinct).
        // We need 5 distinct, so 4 distinct + 1 dup should still fail.
        uint256 nonce = gov.proposalNonce() + 1;
        bytes memory base = _signEmergencyPause(gov, 4, nonce);
        bytes32 digest = keccak256(abi.encode(bytes32("EMERGENCY_PAUSE"), address(gov), block.chainid, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[0], digest);
        bytes memory dupOfFirst = abi.encodePacked(r, s, v);
        bytes memory combined = bytes.concat(base, dupOfFirst);
        vm.expectRevert(Governance.SignatureCountBelowThreshold.selector);
        gov.emergencyPause(nonce, combined);
    }

    function test_StalePauseNonceReverts() public {
        uint256 nonce = gov.proposalNonce() + 1;
        bytes memory sigs = _signEmergencyPause(gov, 5, nonce);
        gov.emergencyPause(nonce, sigs);
        // Now proposalNonce == nonce. Replaying with the old nonce
        // fails the freshness require (it wants proposalNonce + 1).
        vm.expectRevert("stale pause nonce");
        gov.emergencyPause(nonce, sigs);
    }

    function test_RemovedSignerCannotAct() public {
        Governance g = _deploy(48 hours, false);
        // Pull initial signer[8] out via SignerChange.
        vm.prank(signers[0]);
        bytes32 id = g.propose(
            Governance.ProposalKind.SignerChange,
            address(0),
            abi.encode(signers[8], address(0))
        );
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(signers[i]);
            g.approve(id);
        }
        vm.warp(block.timestamp + 48 hours);
        g.execute(id);

        // signers[8] is no longer a signer.
        vm.prank(signers[8]);
        vm.expectRevert(Governance.NotSigner.selector);
        g.propose(Governance.ProposalKind.AdminCall, address(target), "");
    }

    function test_ExecFailedReverts_BubblesUpReason() public {
        bytes32 id = _propose(gov, address(target), abi.encodeCall(Target.detonate, ()), 0);
        _approveN(gov, id, 4, 1);
        vm.expectRevert(); // ExecFailed wraps the reason bytes
        gov.execute(id);
    }

    function test_constructor_rejects_zero_signer() public {
        address[] memory bad = new address[](5);
        bad[0] = address(0);
        for (uint256 i = 1; i < 5; i++) bad[i] = signers[i];
        vm.expectRevert(Governance.ZeroSigner.selector);
        new Governance(bad, 3, 5, 0, true);
    }

    function test_constructor_rejects_duplicate_signers() public {
        address[] memory bad = new address[](5);
        for (uint256 i = 0; i < 5; i++) bad[i] = signers[0];
        vm.expectRevert(Governance.DuplicateSigner.selector);
        new Governance(bad, 3, 5, 0, true);
    }

    function test_constructor_rejects_short_timelock_without_flag() public {
        address[] memory dyn = new address[](5);
        for (uint256 i = 0; i < 5; i++) dyn[i] = signers[i];
        // Non-zero but below MINIMUM_PROD_TIMELOCK is always rejected.
        vm.expectRevert(Governance.TimelockOutOfRange.selector);
        new Governance(dyn, 3, 5, 1 hours, true);
    }

    function test_constructor_rejects_zero_timelock_without_flag() public {
        address[] memory dyn = new address[](5);
        for (uint256 i = 0; i < 5; i++) dyn[i] = signers[i];
        vm.expectRevert(Governance.TimelockTooShort.selector);
        new Governance(dyn, 3, 5, 0, false);
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    function _signEmergencyPause(Governance g, uint256 count, uint256 nonce)
        internal
        view
        returns (bytes memory packed)
    {
        bytes32 digest = keccak256(
            abi.encode(bytes32("EMERGENCY_PAUSE"), address(g), block.chainid, nonce)
        );
        for (uint256 i = 0; i < count; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], digest);
            packed = bytes.concat(packed, abi.encodePacked(r, s, v));
        }
    }
}
