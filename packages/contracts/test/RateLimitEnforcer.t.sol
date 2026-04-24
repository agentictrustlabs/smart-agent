// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/RateLimitEnforcer.sol";

contract RateLimitEnforcerTest is Test {
    RateLimitEnforcer internal enforcer;

    address internal delegator = address(0xA11CE);
    address internal redeemer  = address(0xB0B);
    bytes32 internal delegationHash = keccak256("del#1");
    bytes32 internal scopeKey = keccak256("daily-transfers");

    function setUp() public {
        enforcer = new RateLimitEnforcer();
    }

    function _terms(uint32 maxCalls, uint32 windowSeconds) internal view returns (bytes memory) {
        return enforcer.encodeTerms(scopeKey, maxCalls, windowSeconds);
    }

    function _hit() internal {
        enforcer.beforeHook(
            _terms(3, 60),
            "",
            delegationHash,
            delegator,
            redeemer,
            address(0),
            0,
            ""
        );
    }

    function test_first_call_initialises_window() public {
        _hit();
        (uint64 start, uint32 n) = enforcer.getBucket(delegator, delegationHash, scopeKey);
        assertEq(start, uint64(block.timestamp));
        assertEq(n, 1);
    }

    function test_allows_up_to_max_calls() public {
        _hit();
        _hit();
        _hit(); // 3rd and final call
        (, uint32 n) = enforcer.getBucket(delegator, delegationHash, scopeKey);
        assertEq(n, 3);
    }

    function test_reverts_on_max_plus_one() public {
        _hit();
        _hit();
        _hit();
        bytes memory terms = _terms(3, 60);
        vm.expectRevert(abi.encodeWithSelector(RateLimitEnforcer.RateLimitExceeded.selector, uint32(3), uint32(3)));
        enforcer.beforeHook(terms, "", delegationHash, delegator, redeemer, address(0), 0, "");
    }

    function test_window_rolls_over() public {
        _hit();
        _hit();
        _hit();
        // Advance past the 60s window and try again.
        vm.warp(block.timestamp + 61);
        _hit();
        (uint64 start, uint32 n) = enforcer.getBucket(delegator, delegationHash, scopeKey);
        assertEq(start, uint64(block.timestamp));
        assertEq(n, 1);
    }

    function test_invalid_terms_zero_max() public {
        bytes memory terms = enforcer.encodeTerms(scopeKey, 0, 60);
        vm.expectRevert(RateLimitEnforcer.InvalidTerms.selector);
        enforcer.beforeHook(terms, "", delegationHash, delegator, redeemer, address(0), 0, "");
    }

    function test_invalid_terms_wrong_length() public {
        bytes memory bad = abi.encodePacked(scopeKey, uint32(3)); // missing window
        vm.expectRevert(RateLimitEnforcer.InvalidTerms.selector);
        enforcer.beforeHook(bad, "", delegationHash, delegator, redeemer, address(0), 0, "");
    }

    function test_scopes_are_independent() public {
        _hit();
        _hit();
        _hit(); // exhaust scope A
        bytes32 scopeB = keccak256("monthly-top-up");
        // a different scope under the same delegation is independent
        enforcer.beforeHook(
            enforcer.encodeTerms(scopeB, 1, 60),
            "",
            delegationHash, delegator, redeemer, address(0), 0, ""
        );
        (, uint32 n) = enforcer.getBucket(delegator, delegationHash, scopeB);
        assertEq(n, 1);
    }

    function test_delegations_are_independent() public {
        _hit();
        _hit();
        _hit();
        bytes32 other = keccak256("del#2");
        // a different delegation, same scope, is its own bucket
        enforcer.beforeHook(
            _terms(3, 60),
            "",
            other, delegator, redeemer, address(0), 0, ""
        );
        (, uint32 n) = enforcer.getBucket(delegator, other, scopeKey);
        assertEq(n, 1);
    }

    function test_afterhook_is_noop() public {
        enforcer.afterHook(_terms(1, 60), "", delegationHash, delegator, redeemer, address(0), 0, "");
    }
}
