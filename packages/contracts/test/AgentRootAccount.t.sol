// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentRootAccount.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract AgentRootAccountTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;
    AgentRootAccount public account;

    address public owner;
    uint256 public ownerKey;
    address public other;
    uint256 public otherKey;

    function setUp() public {
        // Create test signers
        (owner, ownerKey) = makeAddrAndKey("owner");
        (other, otherKey) = makeAddrAndKey("other");

        // Deploy EntryPoint
        entryPoint = new EntryPoint();

        // Deploy factory
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)));

        // Deploy agent account via factory
        account = factory.createAccount(owner, 0);

        // Fund the account
        vm.deal(address(account), 10 ether);
    }

    // ─── Deployment ─────────────────────────────────────────────────

    function test_factory_deploys_account() public view {
        assertGt(address(account).code.length, 0, "Account should be deployed");
    }

    function test_factory_deterministic_address() public view {
        address predicted = factory.getAddress(owner, 0);
        assertEq(address(account), predicted, "Address should match prediction");
    }

    function test_factory_returns_existing_on_redeploy() public {
        AgentRootAccount account2 = factory.createAccount(owner, 0);
        assertEq(address(account), address(account2), "Should return same account");
    }

    function test_factory_different_salt_different_address() public {
        AgentRootAccount account2 = factory.createAccount(owner, 1);
        assertTrue(address(account) != address(account2), "Different salt = different address");
    }

    // ─── Owner Management ───────────────────────────────────────────

    function test_initial_owner_is_set() public view {
        assertTrue(account.isOwner(owner), "Initial owner should be set");
        assertEq(account.ownerCount(), 1, "Should have 1 owner");
    }

    function test_non_owner_is_not_owner() public view {
        assertFalse(account.isOwner(other), "Non-owner should not be owner");
    }

    function test_add_owner_via_self_call() public {
        // Simulate a self-call (as if via UserOp execution)
        vm.prank(address(account));
        account.addOwner(other);

        assertTrue(account.isOwner(other), "New owner should be added");
        assertEq(account.ownerCount(), 2, "Should have 2 owners");
    }

    function test_add_owner_reverts_if_not_self() public {
        vm.prank(owner);
        vm.expectRevert(AgentRootAccount.NotFromSelf.selector);
        account.addOwner(other);
    }

    function test_add_owner_reverts_if_already_owner() public {
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(AgentRootAccount.OwnerAlreadyExists.selector, owner));
        account.addOwner(owner);
    }

    function test_add_owner_reverts_if_zero_address() public {
        vm.prank(address(account));
        vm.expectRevert(AgentRootAccount.ZeroAddress.selector);
        account.addOwner(address(0));
    }

    function test_remove_owner_via_self_call() public {
        // Add second owner first
        vm.prank(address(account));
        account.addOwner(other);

        // Remove original owner
        vm.prank(address(account));
        account.removeOwner(owner);

        assertFalse(account.isOwner(owner), "Removed owner should not be owner");
        assertEq(account.ownerCount(), 1, "Should have 1 owner");
    }

    function test_remove_last_owner_reverts() public {
        vm.prank(address(account));
        vm.expectRevert(AgentRootAccount.CannotRemoveLastOwner.selector);
        account.removeOwner(owner);
    }

    function test_remove_non_owner_reverts() public {
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(AgentRootAccount.OwnerDoesNotExist.selector, other));
        account.removeOwner(other);
    }

    // ─── ERC-1271 ───────────────────────────────────────────────────

    function test_erc1271_valid_signature() public view {
        bytes32 hash = keccak256("test message");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        bytes4 result = account.isValidSignature(hash, signature);
        assertEq(result, bytes4(0x1626ba7e), "Valid owner signature should return magic value");
    }

    function test_erc1271_invalid_signature() public view {
        bytes32 hash = keccak256("test message");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        bytes4 result = account.isValidSignature(hash, signature);
        assertEq(result, bytes4(0xffffffff), "Invalid signature should return failure");
    }

    // ─── Execution ──────────────────────────────────────────────────

    function test_execute_from_entrypoint() public {
        address target = makeAddr("target");
        vm.deal(address(account), 1 ether);

        vm.prank(address(entryPoint));
        account.execute(target, 0.5 ether, "");

        assertEq(target.balance, 0.5 ether, "Target should receive ETH");
    }

    function test_execute_reverts_from_unauthorized() public {
        vm.prank(other);
        vm.expectRevert();
        account.execute(other, 0, "");
    }

    // ─── Receive ETH ────────────────────────────────────────────────

    function test_receive_eth() public {
        uint256 balanceBefore = address(account).balance;
        vm.deal(address(this), 1 ether);
        (bool success,) = payable(address(account)).call{value: 1 ether}("");
        assertTrue(success, "Should accept ETH");
        assertEq(address(account).balance, balanceBefore + 1 ether, "Balance should increase");
    }

    // ─── EntryPoint ─────────────────────────────────────────────────

    function test_entrypoint_is_correct() public view {
        assertEq(address(account.entryPoint()), address(entryPoint), "EntryPoint should match");
    }

    function test_get_nonce() public view {
        uint256 nonce = account.getNonce();
        assertEq(nonce, 0, "Initial nonce should be 0");
    }
}
