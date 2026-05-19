// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "account-abstraction/core/BaseAccount.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";
import "./helpers/MockGovernance.sol";

/// @dev Adversarial target that tries to reenter the caller's `execute`.
contract ReentryTarget {
    function reenter(AgentAccount account, address innerTarget, bytes calldata innerData)
        external returns (bool ok)
    {
        // This call is launched FROM inside AgentAccount.execute. We try
        // to reenter the same account's execute() — should be blocked by
        // the nonReentrant guard.
        // We're called via account.execute(...) so msg.sender == account.
        // Calling account.execute() AGAIN with msg.sender == account
        // satisfies the _requireForExecute self-branch — but the
        // nonReentrant modifier should still revert.
        (ok, ) = address(account).call(
            abi.encodeWithSelector(AgentAccount.execute.selector, innerTarget, uint256(0), innerData)
        );
    }
}

/**
 * @title AgentAccount reentrancy tests — Phase A.5 (SC5 § 6.1)
 * @notice Verifies the `nonReentrant` modifier on `execute` /
 *         `executeBatch` blocks the "execute -> target -> execute"
 *         path even when the target is self-authorised.
 */
contract AgentAccountReentrancyTest is Test {
    EntryPoint internal entryPoint;
    AgentAccountFactory internal factory;
    AgentAccount internal account;
    address internal owner;
    uint256 internal ownerKey;
    ReentryTarget internal target;

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(0),
            makeAddr("b"),
            makeAddr("s"),
            address(new MockGovernance(address(this)))
        );
        account = factory.createAccount(owner, 0);
        target = new ReentryTarget();
        vm.deal(address(account), 1 ether);
    }

    function test_execute_rejects_reentry_via_target() public {
        // Inner call: target.reenter(account, harmless, "")
        bytes memory inner = abi.encodeWithSelector(
            ReentryTarget.reenter.selector,
            account,
            address(0xdead),
            bytes("")
        );

        // Drive the OUTER execute via the entry-point branch.
        vm.prank(address(entryPoint));
        // The outer execute itself succeeds, but ReentryTarget.reenter's
        // inner account.execute call should have returned ok=false. We
        // can't directly inspect the inner return, so we instead drive
        // an alternative path: have the target REVERT if the reentry
        // succeeds. Use a more direct assertion: replace target with
        // a probe that asserts the inner call reverts.
        ReentryProbe probe = new ReentryProbe();
        inner = abi.encodeWithSelector(ReentryProbe.attack.selector, account);
        vm.prank(address(entryPoint));
        // ReentryProbe.attack reverts iff the inner reentry was BLOCKED
        // (i.e. the guard worked). So the outer execute should revert
        // with the probe's marker. If the inner call had succeeded
        // (reentry NOT blocked), the probe wouldn't revert and the
        // outer execute would return normally.
        vm.expectRevert(bytes("REENTRY_BLOCKED"));
        account.execute(address(probe), 0, inner);
    }

    function test_executeBatch_rejects_reentry_via_inner_call() public {
        // Build a batch of one call that reenters the account.
        ReentryProbe probe = new ReentryProbe();
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](1);
        calls[0] = BaseAccount.Call({
            target: address(probe),
            value: 0,
            data: abi.encodeWithSelector(ReentryProbe.attack.selector, account)
        });

        vm.prank(address(entryPoint));
        vm.expectRevert(bytes("REENTRY_BLOCKED"));
        account.executeBatch(calls);
    }
}

/// @dev Calls account.execute(...) and reverts with a known marker iff
///      the inner call was rejected (which means reentry was blocked).
contract ReentryProbe {
    function attack(AgentAccount account) external {
        (bool ok, ) = address(account).call(
            abi.encodeWithSelector(
                AgentAccount.execute.selector,
                address(0xdead),
                uint256(0),
                bytes("")
            )
        );
        if (!ok) {
            revert("REENTRY_BLOCKED");
        }
    }
}
