// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/TaskBindingEnforcer.sol";

/// @dev Pure-shape + helper-API tests for TaskBindingEnforcer. The runtime
///      cryptographic binding is handled by CallDataHashEnforcer (see its
///      test); TaskBindingEnforcer's invariant is just that its terms
///      shape is one bytes32 taskId, surfaced via `getTaskId`.
contract TaskBindingEnforcerTest is Test {
    TaskBindingEnforcer internal enf;

    function setUp() public {
        enf = new TaskBindingEnforcer();
    }

    function test_setsTerms_returnsTaskId() public view {
        bytes32 taskId = keccak256("a2a-task-42");
        bytes memory terms = abi.encode(taskId);
        bytes32 got = enf.getTaskId(terms);
        assertEq(got, taskId, "getTaskId should round-trip the encoded value");
    }

    function test_revertsOnBadTermsLength() public {
        bytes memory tooShort = hex"deadbeef";
        vm.expectRevert(TaskBindingEnforcer.BadTermsLength.selector);
        enf.getTaskId(tooShort);

        bytes memory tooLong = abi.encode(keccak256("x"), keccak256("y"));
        vm.expectRevert(TaskBindingEnforcer.BadTermsLength.selector);
        enf.getTaskId(tooLong);
    }

    function test_beforeHook_isNoop_givenValidTerms() public view {
        bytes32 taskId = keccak256("a2a-task-noop");
        bytes memory terms = abi.encode(taskId);

        // Pass with any args/target/callData — the enforcer must not revert.
        enf.beforeHook(
            terms,
            "",
            bytes32(0),
            address(0xA),
            address(0xB),
            address(0xC),
            0,
            hex"1234567890"
        );
    }

    function test_beforeHook_revertsOnBadTermsLength() public {
        bytes memory bad = hex"1234"; // 2 bytes, not 32
        vm.expectRevert(TaskBindingEnforcer.BadTermsLength.selector);
        enf.beforeHook(
            bad,
            "",
            bytes32(0),
            address(0),
            address(0),
            address(0),
            0,
            ""
        );
    }

    function test_afterHook_isNoop() public view {
        enf.afterHook("", "", bytes32(0), address(0), address(0), address(0), 0, "");
    }
}
