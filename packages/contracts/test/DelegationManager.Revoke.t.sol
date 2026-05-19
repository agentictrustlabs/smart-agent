// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/DelegationManager.sol";
import "../src/IDelegationManager.sol";

/**
 * @title DelegationManager revoke tests — Phase A.5 (C2 § 5)
 * @notice Variant A delegations (off-chain) can now be revoked via the
 *         authenticated path. Either the delegator or the delegate may
 *         submit the revoke; a random EOA cannot DoS.
 */
contract DelegationManagerRevokeTest is Test {
    DelegationManager internal dm;
    address internal delegator;
    uint256 internal delegatorKey;
    address internal delegate;
    uint256 internal delegateKey;
    address internal attacker;

    function setUp() public {
        dm = new DelegationManager();
        (delegator, delegatorKey) = makeAddrAndKey("delegator");
        (delegate, delegateKey) = makeAddrAndKey("delegate");
        attacker = makeAddr("attacker");
    }

    function _buildAndSignDelegation() internal view returns (IDelegationManager.Delegation memory d) {
        d = IDelegationManager.Delegation({
            delegator: delegator,
            delegate: delegate,
            authority: dm.ROOT_AUTHORITY(),
            caveats: new IDelegationManager.Caveat[](0),
            salt: 1,
            signature: ""
        });
        bytes32 dHash = dm.hashDelegation(d);
        // EOA path — delegator signs the eth-signed version of dHash
        // (matches DelegationManager._validateSignature's EOA branch).
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(delegatorKey, ethHash);
        d.signature = abi.encodePacked(r, s, v);
    }

    function test_revoke_by_delegator_succeeds() public {
        IDelegationManager.Delegation memory d = _buildAndSignDelegation();
        bytes32 dHash = dm.hashDelegation(d);
        vm.prank(delegator);
        dm.revokeDelegationByOwner(d);
        assertTrue(dm.isRevoked(dHash));
    }

    function test_revoke_by_delegate_succeeds() public {
        IDelegationManager.Delegation memory d = _buildAndSignDelegation();
        bytes32 dHash = dm.hashDelegation(d);
        vm.prank(delegate);
        dm.revokeDelegationByOwner(d);
        assertTrue(dm.isRevoked(dHash));
    }

    function test_revoke_by_random_EOA_reverts() public {
        IDelegationManager.Delegation memory d = _buildAndSignDelegation();
        vm.prank(attacker);
        vm.expectRevert(DelegationManager.NotDelegatorOrDelegate.selector);
        dm.revokeDelegationByOwner(d);
    }

    function test_revoke_with_forged_struct_reverts() public {
        // Delegate fabricates a delegation struct they didn't actually
        // receive — sign with the WRONG key so signature recovers to a
        // different EOA, hitting `InvalidSignature`.
        IDelegationManager.Delegation memory d = IDelegationManager.Delegation({
            delegator: delegator,
            delegate: delegate,
            authority: dm.ROOT_AUTHORITY(),
            caveats: new IDelegationManager.Caveat[](0),
            salt: 99,
            signature: ""
        });
        bytes32 dHash = dm.hashDelegation(d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        // Signed by `delegate`, not by `delegator` — so recovered signer
        // mismatches and DelegationManager reverts InvalidSignature.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(delegateKey, ethHash);
        d.signature = abi.encodePacked(r, s, v);

        vm.prank(delegate);
        vm.expectRevert(DelegationManager.InvalidSignature.selector);
        dm.revokeDelegationByOwner(d);
    }

    function test_revoked_delegation_cannot_be_redeemed() public {
        IDelegationManager.Delegation memory d = _buildAndSignDelegation();
        vm.prank(delegator);
        dm.revokeDelegationByOwner(d);

        // Now attempt redemption — must revert DelegationRevoked_.
        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](1);
        chain[0] = d;
        vm.prank(delegate);
        vm.expectRevert(DelegationManager.DelegationRevoked_.selector);
        dm.redeemDelegation(chain, address(0), 0, "");
    }

    function test_legacy_revokeByHash_still_works() public {
        IDelegationManager.Delegation memory d = _buildAndSignDelegation();
        bytes32 dHash = dm.hashDelegation(d);
        // Legacy path is permissionless — anyone can revoke if they know the hash.
        vm.prank(attacker);
        dm.revokeDelegation(dHash);
        assertTrue(dm.isRevoked(dHash));
    }

    function test_emits_DelegationRevokedBy_with_caller() public {
        IDelegationManager.Delegation memory d = _buildAndSignDelegation();
        bytes32 dHash = dm.hashDelegation(d);
        vm.prank(delegate);
        vm.expectEmit(true, true, false, false, address(dm));
        emit DelegationManager.DelegationRevokedBy(dHash, delegate);
        dm.revokeDelegationByOwner(d);
    }
}
