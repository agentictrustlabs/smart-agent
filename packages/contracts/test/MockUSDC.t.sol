// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/mocks/MockUSDC.sol";

/// Spec 005 unit suite — MockUSDC (U-USDC-1..3 per test-plan.md § 1).
contract MockUSDCTest is Test {
    MockUSDC usdc;
    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");

    function setUp() public {
        usdc = new MockUSDC();
    }

    /// U-USDC-1 — mint(to, 1000) increments balance.
    function test_mint() public {
        usdc.mint(alice, 1000);
        assertEq(usdc.balanceOf(alice), 1000);
        usdc.mint(alice, 500);
        assertEq(usdc.balanceOf(alice), 1500);
    }

    /// U-USDC-2 — transfer moves balances + emits Transfer event.
    function test_transfer() public {
        usdc.mint(alice, 1000);
        vm.expectEmit(true, true, false, true, address(usdc));
        emit Transfer(alice, bob, 400);
        vm.prank(alice);
        bool ok = usdc.transfer(bob, 400);
        assertTrue(ok);
        assertEq(usdc.balanceOf(alice), 600);
        assertEq(usdc.balanceOf(bob), 400);
    }

    /// U-USDC-3 — decimals() returns 6.
    function test_decimals_isSix() public view {
        assertEq(usdc.decimals(), 6);
    }

    // Match the OpenZeppelin ERC-20 event signature.
    event Transfer(address indexed from, address indexed to, uint256 value);
}
