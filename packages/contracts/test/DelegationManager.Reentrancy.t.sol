// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/DelegationManager.sol";
import "../src/IDelegationManager.sol";
import "../src/ICaveatEnforcer.sol";

/**
 * @title DelegationManager reentrancy tests — Phase A.5 (SC5 § 6.2)
 * @notice Verifies the `nonReentrant` modifier on `redeemDelegation`
 *         blocks nested redemption via a malicious caveat enforcer.
 */

/// @dev Malicious enforcer that, in beforeHook, tries to call back into
///      DelegationManager.redeemDelegation. The guard must revert this.
contract ReentrantEnforcer is ICaveatEnforcer {
    DelegationManager public immutable dm;
    IDelegationManager.Delegation[] public toRedeem;
    bool public attempted;

    constructor(DelegationManager dm_) { dm = dm_; }

    function setReentry(IDelegationManager.Delegation calldata d) external {
        delete toRedeem;
        toRedeem.push(d);
    }

    function beforeHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external override {
        attempted = true;
        // Try to reenter — should revert ReentrancyGuardReentrantCall.
        dm.redeemDelegation(toRedeem, address(0xdead), 0, "");
    }

    function afterHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external override {}
}

contract DelegationManagerReentrancyTest is Test {
    DelegationManager internal dm;
    ReentrantEnforcer internal evil;
    address internal delegator;
    uint256 internal delegatorKey;
    address internal delegate;

    function setUp() public {
        dm = new DelegationManager();
        evil = new ReentrantEnforcer(dm);
        (delegator, delegatorKey) = makeAddrAndKey("delegator");
        delegate = makeAddr("delegate");
    }

    function _signedDelegation() internal view returns (IDelegationManager.Delegation memory d) {
        IDelegationManager.Caveat[] memory caveats = new IDelegationManager.Caveat[](1);
        caveats[0] = IDelegationManager.Caveat({
            enforcer: address(evil),
            terms: "",
            args: ""
        });
        d = IDelegationManager.Delegation({
            delegator: delegator,
            delegate: delegate,
            authority: dm.ROOT_AUTHORITY(),
            caveats: caveats,
            salt: 1,
            signature: ""
        });
        bytes32 dHash = dm.hashDelegation(d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(delegatorKey, ethHash);
        d.signature = abi.encodePacked(r, s, v);
    }

    function test_reentrant_enforcer_is_rejected() public {
        IDelegationManager.Delegation memory d = _signedDelegation();
        evil.setReentry(d);

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](1);
        chain[0] = d;

        vm.prank(delegate);
        // The reentered redeemDelegation call hits ReentrancyGuard's
        // ReentrancyGuardReentrantCall error. That error bubbles up
        // through the caveat enforcer to the OUTER redeem, which
        // reverts with the same error.
        vm.expectRevert(); // ReentrancyGuardReentrantCall()
        dm.redeemDelegation(chain, address(0xdead), 0, "");
    }
}
