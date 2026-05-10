// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/CallDataHashEnforcer.sol";

contract CallDataHashEnforcerTest is Test {
    CallDataHashEnforcer internal enf;

    function setUp() public {
        enf = new CallDataHashEnforcer();
    }

    function test_matchesExactCallData() public view {
        bytes memory callData = hex"a9059cbb000000000000000000000000abcdef0000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000007b";
        bytes32 expected = keccak256(callData);
        bytes memory terms = abi.encode(expected);

        // Should NOT revert when actual calldata hashes to the bound value.
        enf.beforeHook(
            terms,
            "",
            bytes32(0),
            address(0xA),
            address(0xB),
            address(0xC),
            0,
            callData
        );
    }

    function test_revertsOnMismatchedCallData() public {
        bytes memory boundCallData = hex"aaaaaaaa";
        bytes memory wrongCallData = hex"bbbbbbbb";
        bytes32 expected = keccak256(boundCallData);
        bytes32 actual = keccak256(wrongCallData);
        bytes memory terms = abi.encode(expected);

        vm.expectRevert(
            abi.encodeWithSelector(CallDataHashEnforcer.CallDataMismatch.selector, expected, actual)
        );
        enf.beforeHook(
            terms,
            "",
            bytes32(0),
            address(0),
            address(0),
            address(0),
            0,
            wrongCallData
        );
    }

    function test_revertsOnBadTermsLength() public {
        // 16-byte terms — wrong shape.
        bytes memory bad = hex"00112233445566778899aabbccddeeff";
        vm.expectRevert(CallDataHashEnforcer.BadTermsLength.selector);
        enf.beforeHook(
            bad,
            "",
            bytes32(0),
            address(0),
            address(0),
            address(0),
            0,
            hex"deadbeef"
        );
    }

    function test_emptyCallData_isStillBindable() public view {
        // Edge case — empty calldata has a valid keccak256.
        bytes memory empty = "";
        bytes32 expected = keccak256(empty);
        bytes memory terms = abi.encode(expected);
        enf.beforeHook(
            terms,
            "",
            bytes32(0),
            address(0),
            address(0),
            address(0),
            0,
            empty
        );
    }

    function test_afterHook_isNoop() public view {
        enf.afterHook("", "", bytes32(0), address(0), address(0), address(0), 0, "");
    }
}
