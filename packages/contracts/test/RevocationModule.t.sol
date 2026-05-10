// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/DelegationManager.sol";
import "../src/modules/RevocationModule.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract RevocationModuleTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;
    AgentAccount public account;
    DelegationManager public dm;
    RevocationModule public module;
    address public owner;

    uint256 constant MOD_EXECUTOR = 2;

    function setUp() public {
        owner = makeAddr("owner");
        entryPoint = new EntryPoint();
        dm = new DelegationManager();
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(dm), address(this));
        account = factory.createAccount(owner, 0);
        vm.deal(address(account), 1 ether);
        module = new RevocationModule();
    }

    function test_install_records_dm_per_account() public {
        vm.prank(owner);
        account.installModule(MOD_EXECUTOR, address(module), abi.encode(address(dm)));
        assertEq(module.delegationManagerOf(address(account)), address(dm));
    }

    function test_install_revertsOnZeroDM() public {
        vm.prank(owner);
        vm.expectRevert();
        account.installModule(MOD_EXECUTOR, address(module), abi.encode(address(0)));
    }

    function test_revokes_via_account_self_call() public {
        vm.prank(owner);
        account.installModule(MOD_EXECUTOR, address(module), abi.encode(address(dm)));

        bytes32 someHash = keccak256("delegation-1");
        assertFalse(dm.isRevoked(someHash));

        // Account executes a call to module.revoke(hash) via its execute path.
        bytes memory cd = abi.encodeCall(RevocationModule.revoke, (someHash));
        vm.prank(address(entryPoint));
        account.execute(address(module), 0, cd);

        assertTrue(dm.isRevoked(someHash), "should be revoked");
    }

    function test_revoke_revertsIfNotConfigured() public {
        // No install on this account.
        bytes32 someHash = keccak256("delegation-1");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        module.revoke(someHash);
    }

    function test_uninstall_clears_state() public {
        vm.prank(owner);
        account.installModule(MOD_EXECUTOR, address(module), abi.encode(address(dm)));
        vm.prank(owner);
        account.uninstallModule(MOD_EXECUTOR, address(module), "");
        assertEq(module.delegationManagerOf(address(account)), address(0));
    }

    function test_isModuleType_executor_only() public view {
        assertTrue(module.isModuleType(2));
        assertFalse(module.isModuleType(1));
        assertFalse(module.isModuleType(4));
    }
}
