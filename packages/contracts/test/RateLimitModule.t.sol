// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/modules/RateLimitHookModule.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract Sink { uint256 public x; function poke(uint256 v) external { x = v; } }

contract RateLimitModuleTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;
    AgentAccount public account;
    RateLimitHookModule public module;
    Sink public sink;
    address public owner;

    uint256 constant MOD_HOOK = 4;

    function setUp() public {
        owner = makeAddr("owner");
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        account = factory.createAccount(owner, 0);
        vm.deal(address(account), 1 ether);
        module = new RateLimitHookModule();
        sink = new Sink();
    }

    function _install(uint256 window, uint256 max) internal {
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(module), abi.encode(window, max));
    }

    function _callOnce() internal {
        bytes memory cd = abi.encodeCall(Sink.poke, (1));
        vm.prank(address(entryPoint));
        account.execute(address(sink), 0, cd);
    }

    function test_under_limit_succeeds() public {
        _install(3600, 3);
        _callOnce();
        _callOnce();
        _callOnce();
        (,, , uint64 calls) = module.getState(address(account));
        assertEq(calls, 3);
    }

    function test_fourth_call_in_window_reverts() public {
        _install(3600, 3);
        _callOnce();
        _callOnce();
        _callOnce();
        vm.prank(address(entryPoint));
        vm.expectRevert();
        account.execute(address(sink), 0, abi.encodeCall(Sink.poke, (1)));
    }

    function test_window_rolls_over_resets_count() public {
        _install(100, 2);
        _callOnce();
        _callOnce();

        // Window rolls
        vm.warp(block.timestamp + 101);
        _callOnce();
        _callOnce();
        (,, , uint64 calls) = module.getState(address(account));
        assertEq(calls, 2, "count reset on rollover");
    }

    function test_uninstall_clears_state() public {
        _install(100, 5);
        _callOnce();
        vm.prank(owner);
        account.uninstallModule(MOD_HOOK, address(module), "");
        (uint64 w, uint64 m, , ) = module.getState(address(account));
        assertEq(w, 0);
        assertEq(m, 0);
    }

    function test_install_revertsOnZeroParams() public {
        vm.prank(owner);
        vm.expectRevert();
        account.installModule(MOD_HOOK, address(module), abi.encode(uint256(0), uint256(1)));
    }
}
