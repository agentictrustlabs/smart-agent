// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import "../src/DelegationManager.sol";
import "../src/enforcers/TimestampEnforcer.sol";
import "../src/enforcers/AllowedTargetsEnforcer.sol";
import "../src/enforcers/AllowedMethodsEnforcer.sol";
import "../src/enforcers/ValueEnforcer.sol";
import "../src/enforcers/CallDataHashEnforcer.sol";
import "../src/enforcers/TaskBindingEnforcer.sol";
import {IDelegationManager} from "../src/IDelegationManager.sol";

/// @dev Mock smart account — accepts `execute` from anyone for test purposes.
///      Real AgentAccount restricts msg.sender via `_requireForExecute`, but
///      that auth path is exercised in AgentAccount.t.sol; here we focus on
///      DelegationManager chain semantics + the new sub-delegation enforcers.
contract MockSmartAccount {
    event Executed(address indexed target, uint256 value, bytes data);

    receive() external payable {}

    function execute(address target, uint256 value, bytes calldata data) external {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            if (ret.length > 0) {
                assembly { revert(add(ret, 32), mload(ret)) }
            }
            revert("MockSmartAccount: execute failed");
        }
        emit Executed(target, value, data);
    }
}

/// @dev Mock target — records the last calldata + caller.
contract MockTarget {
    bytes public lastCallData;
    address public lastCaller;
    uint256 public callCount;

    function setValue(uint256 v) external {
        lastCallData = abi.encodeWithSignature("setValue(uint256)", v);
        lastCaller = msg.sender;
        callCount++;
    }
}

/// @notice Compromise-simulation tests for Phase 2 sub-delegated path.
///
/// The architecture under test:
///   - User's smart account (MockSmartAccount) signs D_root → sessionKey (EOA).
///   - sessionKey signs D_sub → executor (EOA) with:
///       Timestamp(now, now+60s)
///       AllowedTargets([target])
///       AllowedMethods([setValue.selector])
///       Value(0)
///       CallDataHashEnforcer(keccak256(callData))
///       TaskBindingEnforcer(taskId)
///   - Executor submits redeemDelegation([D_sub, D_root], target, 0, callData).
///
/// The key invariants we verify:
///
///   1. The "leaked session key" cannot replay a D_sub for the same calldata —
///      because (after a successful submit) the redeemer revokes hash(D_sub)
///      via DelegationManager.revokeDelegation.
///
///   2. The session key CAN mint a fresh D_sub for DIFFERENT calldata — that's
///      correct authorized behavior. The blast-radius is bounded by D_root
///      (allowed targets/selectors) and the per-call enforcers.
///
///   3. Tampering D_sub fields breaks the chain at DelegationManager validation
///      (InvalidDelegate / InvalidAuthority / InvalidSignature).
///
///   4. A redeem whose actual calldata doesn't match D_sub's
///      CallDataHashEnforcer terms reverts with CallDataMismatch.
contract SubDelegationCompromiseTest is Test {
    using MessageHashUtils for bytes32;

    DelegationManager internal dm;
    TimestampEnforcer internal tsEnf;
    AllowedTargetsEnforcer internal targetsEnf;
    AllowedMethodsEnforcer internal methodsEnf;
    ValueEnforcer internal valueEnf;
    CallDataHashEnforcer internal cdhEnf;
    TaskBindingEnforcer internal tbEnf;

    MockSmartAccount internal userAccount;
    MockTarget internal target;

    // Session principal (EOA — D_root delegate; D_sub delegator).
    address internal sessionKey;
    uint256 internal sessionKeyPk;

    // Tool executor (EOA — D_sub delegate).
    address internal executor;
    uint256 internal executorPk;

    // For signature verification, the userAccount needs to be an ERC-1271
    // smart account. Our MockSmartAccount doesn't implement isValidSignature,
    // so instead we use an EOA "user" and have D_root.delegator be that EOA's
    // address but wrap the calldata-execute via MockSmartAccount address.
    //
    // Simpler: use an EOA as the delegator for the root delegation and have
    // the EOA implement an `execute` shim. We rebuild that by giving the
    // userAccount an associated key.
    //
    // Cleanest: use TWO test EOAs — one is the "user-controlled delegator"
    // that signs D_root, and we deploy a MockSmartAccount whose `execute`
    // entrypoint is what DelegationManager calls. To keep `_validateSignature`
    // happy we set the delegator field to an EOA address with the matching
    // private key, then route execution through the MockSmartAccount by
    // setting `delegator` to MockSmartAccount's address.
    //
    // For ERC-1271 validation: we'd need a smart account that returns the
    // magic value. To keep this test focused, we patch MockSmartAccount to
    // also return the ERC-1271 magic for any signature (delegator authorizes
    // by EOA signature externally).
    //
    // In this test we wire D_root.delegator = MockSmartAccount address, and
    // sign with a separate "owner" key. We make MockSmartAccount accept any
    // signature as valid (test-only) so DelegationManager._validateSignature
    // routes through ERC-1271 successfully.

    function setUp() public {
        dm = new DelegationManager();
        tsEnf = new TimestampEnforcer();
        targetsEnf = new AllowedTargetsEnforcer();
        methodsEnf = new AllowedMethodsEnforcer();
        valueEnf = new ValueEnforcer();
        cdhEnf = new CallDataHashEnforcer();
        tbEnf = new TaskBindingEnforcer();

        userAccount = new MockSmartAccount();
        target = new MockTarget();

        (sessionKey, sessionKeyPk) = makeAddrAndKey("sessionKey");
        (executor, executorPk) = makeAddrAndKey("executor");

        // Make the userAccount return ERC-1271 magic for any sig (test-only).
        vm.etch(address(userAccount), bytes.concat(
            type(MockSmartAccountWithErc1271).runtimeCode
        ));
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    function _signEoa(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        bytes32 ethHash = digest.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _buildRootDelegation(uint256 salt) internal view returns (IDelegationManager.Delegation memory d, bytes32 hash) {
        // D_root: user smart account → sessionKey. Minimal caveats; the
        // real one has more but the chain semantics are the same.
        IDelegationManager.Caveat[] memory caveats = new IDelegationManager.Caveat[](1);
        caveats[0] = IDelegationManager.Caveat({
            enforcer: address(tsEnf),
            terms: abi.encode(block.timestamp - 1, block.timestamp + 1 days),
            args: ""
        });

        d = IDelegationManager.Delegation({
            delegator: address(userAccount),
            delegate: sessionKey,
            authority: bytes32(uint256(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)),
            caveats: caveats,
            salt: salt,
            signature: hex"00" // accepted by ERC-1271 mock
        });
        hash = dm.hashDelegation(d);
    }

    function _buildSubDelegation(
        bytes32 parentHash,
        address allowedTarget,
        bytes4 allowedSelector,
        bytes32 callDataHash,
        bytes32 taskIdHash,
        uint256 salt
    ) internal view returns (IDelegationManager.Delegation memory d, bytes32 hash) {
        IDelegationManager.Caveat[] memory caveats = new IDelegationManager.Caveat[](6);
        caveats[0] = IDelegationManager.Caveat({
            enforcer: address(tsEnf),
            terms: abi.encode(block.timestamp - 1, block.timestamp + 60),
            args: ""
        });
        address[] memory ts = new address[](1);
        ts[0] = allowedTarget;
        caveats[1] = IDelegationManager.Caveat({
            enforcer: address(targetsEnf),
            terms: abi.encode(ts),
            args: ""
        });
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = allowedSelector;
        caveats[2] = IDelegationManager.Caveat({
            enforcer: address(methodsEnf),
            terms: abi.encode(sels),
            args: ""
        });
        caveats[3] = IDelegationManager.Caveat({
            enforcer: address(valueEnf),
            terms: abi.encode(uint256(0)),
            args: ""
        });
        caveats[4] = IDelegationManager.Caveat({
            enforcer: address(cdhEnf),
            terms: abi.encode(callDataHash),
            args: ""
        });
        caveats[5] = IDelegationManager.Caveat({
            enforcer: address(tbEnf),
            terms: abi.encode(taskIdHash),
            args: ""
        });

        d = IDelegationManager.Delegation({
            delegator: sessionKey,
            delegate: executor,
            authority: parentHash,
            caveats: caveats,
            salt: salt,
            signature: ""
        });
        bytes32 unsignedHash = dm.hashDelegation(d);
        d.signature = _signEoa(sessionKeyPk, unsignedHash);
        hash = unsignedHash;
    }

    // ─── Tests ─────────────────────────────────────────────────────────

    function test_happyPath_executorSubmitsRedeem() public {
        (IDelegationManager.Delegation memory dRoot, bytes32 rootHash) = _buildRootDelegation(1);
        bytes memory callData = abi.encodeWithSelector(MockTarget.setValue.selector, 42);
        bytes32 cdh = keccak256(callData);
        bytes32 taskId = keccak256("task-happy");
        (IDelegationManager.Delegation memory dSub,) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector, cdh, taskId, 100
        );

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = dSub;
        chain[1] = dRoot;

        vm.prank(executor);
        dm.redeemDelegation(chain, address(target), 0, callData);
        assertEq(target.callCount(), 1, "happy path should increment callCount");
    }

    function test_leakedSessionKey_cannotReplaySubDelegationForSameCalldata() public {
        (IDelegationManager.Delegation memory dRoot, bytes32 rootHash) = _buildRootDelegation(2);
        bytes memory callData = abi.encodeWithSelector(MockTarget.setValue.selector, 7);
        bytes32 cdh = keccak256(callData);
        bytes32 taskId = keccak256("task-replay");
        (IDelegationManager.Delegation memory dSub, bytes32 subHash) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector, cdh, taskId, 200
        );

        // First submit — should succeed.
        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = dSub;
        chain[1] = dRoot;
        vm.prank(executor);
        dm.redeemDelegation(chain, address(target), 0, callData);

        // Simulate a2a-agent's post-submit revoke (anyone can call).
        dm.revokeDelegation(subHash);

        // Second submit with the SAME D_sub + SAME calldata — should revert
        // at the revoked-check.
        vm.prank(executor);
        vm.expectRevert(DelegationManager.DelegationRevoked_.selector);
        dm.redeemDelegation(chain, address(target), 0, callData);
    }

    function test_leakedSessionKey_canMintFreshSubDelegationForDifferentCalldata() public {
        (IDelegationManager.Delegation memory dRoot, bytes32 rootHash) = _buildRootDelegation(3);

        // First call: setValue(1).
        bytes memory cd1 = abi.encodeWithSelector(MockTarget.setValue.selector, 1);
        (IDelegationManager.Delegation memory dSub1, bytes32 subHash1) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector, keccak256(cd1), keccak256("t1"), 301
        );
        IDelegationManager.Delegation[] memory chain1 = new IDelegationManager.Delegation[](2);
        chain1[0] = dSub1;
        chain1[1] = dRoot;
        vm.prank(executor);
        dm.redeemDelegation(chain1, address(target), 0, cd1);
        dm.revokeDelegation(subHash1);

        // Second call: setValue(2). Fresh D_sub, new salt, different callData.
        bytes memory cd2 = abi.encodeWithSelector(MockTarget.setValue.selector, 2);
        (IDelegationManager.Delegation memory dSub2,) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector, keccak256(cd2), keccak256("t2"), 302
        );
        IDelegationManager.Delegation[] memory chain2 = new IDelegationManager.Delegation[](2);
        chain2[0] = dSub2;
        chain2[1] = dRoot;
        vm.prank(executor);
        dm.redeemDelegation(chain2, address(target), 0, cd2);

        assertEq(target.callCount(), 2, "second fresh redeem should succeed");
    }

    function test_tamperedSubDelegation_delegate_fails() public {
        (IDelegationManager.Delegation memory dRoot, bytes32 rootHash) = _buildRootDelegation(4);
        bytes memory callData = abi.encodeWithSelector(MockTarget.setValue.selector, 5);
        (IDelegationManager.Delegation memory dSub,) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector, keccak256(callData), keccak256("t3"), 400
        );

        // Mutate D_sub.delegate so executor's msg.sender doesn't match.
        // Signature would also fail, but the InvalidDelegate check runs first.
        address attacker = address(0xBAD);
        dSub.delegate = attacker;

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = dSub;
        chain[1] = dRoot;
        vm.prank(executor);
        vm.expectRevert(DelegationManager.InvalidDelegate.selector);
        dm.redeemDelegation(chain, address(target), 0, callData);
    }

    function test_tamperedSubDelegation_authority_fails() public {
        (IDelegationManager.Delegation memory dRoot, bytes32 rootHash) = _buildRootDelegation(5);
        bytes memory callData = abi.encodeWithSelector(MockTarget.setValue.selector, 9);
        (IDelegationManager.Delegation memory dSub,) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector, keccak256(callData), keccak256("t4"), 500
        );

        // Mutate D_sub.authority so it doesn't match hash(D_root).
        dSub.authority = keccak256("not-the-root");

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = dSub;
        chain[1] = dRoot;
        vm.prank(executor);
        // The chain validator will see the authority mismatch (sub claims
        // it's not ROOT_AUTHORITY but parent[0]=dRoot doesn't hash to the
        // claimed authority).
        vm.expectRevert(DelegationManager.InvalidAuthority.selector);
        dm.redeemDelegation(chain, address(target), 0, callData);
    }

    function test_callDataMismatch_fails() public {
        (IDelegationManager.Delegation memory dRoot, bytes32 rootHash) = _buildRootDelegation(6);
        bytes memory boundCallData = abi.encodeWithSelector(MockTarget.setValue.selector, 11);
        bytes memory wrongCallData = abi.encodeWithSelector(MockTarget.setValue.selector, 99);
        (IDelegationManager.Delegation memory dSub,) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector,
            keccak256(boundCallData), keccak256("t5"), 600
        );

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = dSub;
        chain[1] = dRoot;
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                CallDataHashEnforcer.CallDataMismatch.selector,
                keccak256(boundCallData),
                keccak256(wrongCallData)
            )
        );
        dm.redeemDelegation(chain, address(target), 0, wrongCallData);
    }

    function test_expiredSubDelegation_fails() public {
        (IDelegationManager.Delegation memory dRoot, bytes32 rootHash) = _buildRootDelegation(7);
        bytes memory callData = abi.encodeWithSelector(MockTarget.setValue.selector, 3);
        (IDelegationManager.Delegation memory dSub,) = _buildSubDelegation(
            rootHash, address(target), MockTarget.setValue.selector, keccak256(callData), keccak256("t6"), 700
        );

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = dSub;
        chain[1] = dRoot;

        // Advance time past the 60s D_sub window.
        vm.warp(block.timestamp + 120);

        vm.prank(executor);
        vm.expectRevert(TimestampEnforcer.TimestampExpired.selector);
        dm.redeemDelegation(chain, address(target), 0, callData);
    }
}

/// @dev Test-only smart account that accepts any signature as valid ERC-1271.
///      Used by SubDelegationCompromiseTest via vm.etch — we focus on the
///      sub-delegation chain semantics, not on signature validation (which
///      AgentAccount.t.sol covers).
contract MockSmartAccountWithErc1271 {
    event Executed(address indexed target, uint256 value, bytes data);

    receive() external payable {}

    function execute(address target, uint256 value, bytes calldata data) external {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            if (ret.length > 0) {
                assembly { revert(add(ret, 32), mload(ret)) }
            }
            revert("MockSmartAccount: execute failed");
        }
        emit Executed(target, value, data);
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e; // ERC-1271 magic value
    }
}
