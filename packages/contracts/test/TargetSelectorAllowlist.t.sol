// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/modules/TargetSelectorAllowlistHookModule.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract Target { function foo() external pure returns (uint256) { return 1; } function bar() external pure returns (uint256) { return 2; } }

contract TargetSelectorAllowlistTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;
    AgentAccount public account;
    TargetSelectorAllowlistHookModule public module;
    Target public t1;
    Target public t2;
    address public owner;

    uint256 constant MOD_HOOK = 4;

    function setUp() public {
        owner = makeAddr("owner");
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        account = factory.createAccount(owner, 0);
        vm.deal(address(account), 1 ether);
        module = new TargetSelectorAllowlistHookModule();
        t1 = new Target();
        t2 = new Target();
    }

    function _install(address[] memory ts, bytes4[] memory sels) internal {
        vm.prank(owner);
        account.installModule(MOD_HOOK, address(module), abi.encode(ts, sels));
    }

    function test_allowed_passes() public {
        address[] memory ts = new address[](1);
        bytes4[] memory sels = new bytes4[](1);
        ts[0] = address(t1);
        sels[0] = Target.foo.selector;
        _install(ts, sels);

        vm.prank(address(entryPoint));
        account.execute(address(t1), 0, abi.encodeCall(Target.foo, ()));
        // no revert
        assertTrue(true);
    }

    function test_disallowed_target_reverts() public {
        address[] memory ts = new address[](1);
        bytes4[] memory sels = new bytes4[](1);
        ts[0] = address(t1);
        sels[0] = Target.foo.selector;
        _install(ts, sels);

        // t2.foo() — t2 not in allowlist
        vm.prank(address(entryPoint));
        vm.expectRevert();
        account.execute(address(t2), 0, abi.encodeCall(Target.foo, ()));
    }

    function test_disallowed_selector_reverts() public {
        address[] memory ts = new address[](1);
        bytes4[] memory sels = new bytes4[](1);
        ts[0] = address(t1);
        sels[0] = Target.foo.selector;
        _install(ts, sels);

        // t1.bar() — different selector
        vm.prank(address(entryPoint));
        vm.expectRevert();
        account.execute(address(t1), 0, abi.encodeCall(Target.bar, ()));
    }

    function test_self_call_always_allowed() public {
        // Install empty allowlist
        address[] memory ts = new address[](0);
        bytes4[] memory sels = new bytes4[](0);
        _install(ts, sels);
        // Self-call should pass even though allowlist is empty.
        vm.prank(address(entryPoint));
        account.execute(address(account), 0, "");
    }

    function test_owner_adds_runtime() public {
        address[] memory ts = new address[](0);
        bytes4[] memory sels = new bytes4[](0);
        _install(ts, sels);

        // Account adds an allowed entry via self-execute.
        // execute(target=module, value=0, data=addAllowed(t1, foo))
        bytes memory addCall = abi.encodeCall(
            TargetSelectorAllowlistHookModule.addAllowed,
            (address(t1), Target.foo.selector)
        );
        vm.prank(address(entryPoint));
        account.execute(address(module), 0, addCall);

        // Now foo on t1 should be allowed.
        vm.prank(address(entryPoint));
        account.execute(address(t1), 0, abi.encodeCall(Target.foo, ()));

        assertTrue(module.isAllowed(address(account), address(t1), Target.foo.selector));
    }

    function test_install_revertsOnLengthMismatch() public {
        address[] memory ts = new address[](2);
        ts[0] = address(t1);
        ts[1] = address(t2);
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = Target.foo.selector;
        vm.prank(owner);
        vm.expectRevert();
        account.installModule(MOD_HOOK, address(module), abi.encode(ts, sels));
    }
}
