// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";
import "./helpers/MockGovernance.sol";

/// @dev V2 implementation used as the upgrade target.
contract AgentAccountV2 is AgentAccount {
    constructor(IEntryPoint ep) AgentAccount(ep) {}
    function v2Tag() external pure returns (string memory) { return "v2"; }
}

/**
 * @title AgentAccount upgrade-timelock tests — Phase A.5
 * @notice Verifies the optional per-account upgrade timelock:
 *           - Default (0) keeps backward-compat: upgrades fire immediately.
 *           - >0 queues a pending upgrade; execute after readyAt; cancel
 *             during window with owner sig.
 */
contract AgentAccountUpgradeTimelockTest is Test {
    EntryPoint internal entryPoint;
    AgentAccountFactory internal factory;
    AgentAccount internal account;
    AgentAccountV2 internal v2;

    address internal owner;
    uint256 internal ownerKey;
    address internal attacker;
    uint256 internal attackerKey;

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");
        (attacker, attackerKey) = makeAddrAndKey("attacker");
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(0),
            makeAddr("b"),
            makeAddr("s"),
            address(new MockGovernance(address(this)))
        );
        account = factory.createAccount(owner, 0);
        v2 = new AgentAccountV2(IEntryPoint(address(entryPoint)));
    }

    function _signUpgrade(address impl, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(bytes32("UPGRADE"), impl, address(account), block.chainid));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signCancel(address impl, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(bytes32("UPGRADE_CANCEL"), impl, address(account), block.chainid));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _setTimelock(uint256 secs) internal {
        vm.prank(address(account));
        account.setUpgradeTimelock(secs);
    }

    // ─── Backward-compat: timelock = 0 ───────────────────────────────

    function test_timelock_zero_immediate_upgrade() public {
        bytes memory sig = _signUpgrade(address(v2), ownerKey);
        account.upgradeToWithAuthorization(address(v2), sig);
        // The proxy now points at v2 — verify by calling v2-specific function.
        assertEq(AgentAccountV2(payable(address(account))).v2Tag(), "v2");
        // No pending upgrade should be recorded.
        (address impl, uint64 ready) = account.pendingUpgrade();
        assertEq(impl, address(0));
        assertEq(ready, 0);
    }

    // ─── Timelocked queue + execute + cancel ─────────────────────────

    function test_setUpgradeTimelock_onlySelf() public {
        // Direct call from EOA fails.
        vm.expectRevert(AgentAccount.NotFromSelf.selector);
        account.setUpgradeTimelock(1 days);
        // Self-call succeeds.
        vm.prank(address(account));
        account.setUpgradeTimelock(1 days);
        assertEq(account.upgradeTimelock(), 1 days);
    }

    function test_setUpgradeTimelock_rejects_too_long() public {
        vm.prank(address(account));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccount.UpgradeTimelockTooLong.selector,
                31 days,
                30 days
            )
        );
        account.setUpgradeTimelock(31 days);
    }

    function test_upgrade_with_timelock_queues_pending() public {
        _setTimelock(1 days);

        bytes memory sig = _signUpgrade(address(v2), ownerKey);
        account.upgradeToWithAuthorization(address(v2), sig);

        // No upgrade happened yet.
        assertEq(account.version(), "2.2.0", "still on v1 impl");

        (address impl, uint64 ready) = account.pendingUpgrade();
        assertEq(impl, address(v2));
        assertEq(ready, uint64(block.timestamp + 1 days));
    }

    function test_executePendingUpgrade_after_window_succeeds() public {
        _setTimelock(1 days);
        bytes memory sig = _signUpgrade(address(v2), ownerKey);
        account.upgradeToWithAuthorization(address(v2), sig);

        vm.warp(block.timestamp + 1 days);
        // Anyone can execute — including an arbitrary EOA paying gas.
        vm.prank(makeAddr("bystander"));
        account.executePendingUpgrade();
        assertEq(AgentAccountV2(payable(address(account))).v2Tag(), "v2");

        // Pending cleared.
        (address impl, uint64 ready) = account.pendingUpgrade();
        assertEq(impl, address(0));
        assertEq(ready, 0);
    }

    function test_executePendingUpgrade_before_window_reverts() public {
        _setTimelock(1 days);
        bytes memory sig = _signUpgrade(address(v2), ownerKey);
        account.upgradeToWithAuthorization(address(v2), sig);

        vm.expectRevert();
        account.executePendingUpgrade();
    }

    function test_executePendingUpgrade_with_no_pending_reverts() public {
        vm.expectRevert(AgentAccount.NoPendingUpgrade.selector);
        account.executePendingUpgrade();
    }

    function test_cancelPendingUpgrade_during_window() public {
        _setTimelock(1 days);
        bytes memory sig = _signUpgrade(address(v2), ownerKey);
        account.upgradeToWithAuthorization(address(v2), sig);

        bytes memory cancelSig = _signCancel(address(v2), ownerKey);
        account.cancelPendingUpgrade(cancelSig);

        // Pending cleared.
        (address impl, uint64 ready) = account.pendingUpgrade();
        assertEq(impl, address(0));
        assertEq(ready, 0);

        // executePendingUpgrade now reverts NoPendingUpgrade.
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(AgentAccount.NoPendingUpgrade.selector);
        account.executePendingUpgrade();
    }

    function test_cancelPendingUpgrade_requires_owner_sig() public {
        _setTimelock(1 days);
        bytes memory sig = _signUpgrade(address(v2), ownerKey);
        account.upgradeToWithAuthorization(address(v2), sig);

        bytes memory badSig = _signCancel(address(v2), attackerKey);
        vm.expectRevert(AgentAccount.NotOwnerSig.selector);
        account.cancelPendingUpgrade(badSig);
    }

    function test_cancel_with_no_pending_reverts() public {
        bytes memory cancelSig = _signCancel(address(v2), ownerKey);
        vm.expectRevert(AgentAccount.NoPendingUpgrade.selector);
        account.cancelPendingUpgrade(cancelSig);
    }

    function test_double_queue_reverts_until_cancel() public {
        _setTimelock(1 days);
        AgentAccountV2 v2b = new AgentAccountV2(IEntryPoint(address(entryPoint)));

        bytes memory sigA = _signUpgrade(address(v2), ownerKey);
        account.upgradeToWithAuthorization(address(v2), sigA);

        // Second queue attempt reverts.
        bytes memory sigB = _signUpgrade(address(v2b), ownerKey);
        vm.expectRevert(AgentAccount.UpgradePending.selector);
        account.upgradeToWithAuthorization(address(v2b), sigB);

        // Cancel the first; second queue now works.
        bytes memory cancelSig = _signCancel(address(v2), ownerKey);
        account.cancelPendingUpgrade(cancelSig);
        account.upgradeToWithAuthorization(address(v2b), sigB);
        (address impl,) = account.pendingUpgrade();
        assertEq(impl, address(v2b));
    }
}
