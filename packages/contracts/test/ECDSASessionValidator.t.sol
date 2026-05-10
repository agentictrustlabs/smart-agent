// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/modules/ECDSASessionValidator.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";

/**
 * @title ECDSASessionValidatorTest
 * @notice Validator unit tests — install + validateUserOp behavior with
 *         valid/invalid/expired signers. SessionAgentAccount integration
 *         lives in a separate test (deferred — we exercise the validator
 *         in isolation here using vm.prank-as-account).
 */
contract ECDSASessionValidatorTest is Test {
    ECDSASessionValidator public validator;
    address public account;        // the smart-account installing the validator
    address public signer;
    uint256 public signerKey;
    bytes32 public sessionId = keccak256("session-1");

    function setUp() public {
        validator = new ECDSASessionValidator();
        account = makeAddr("account");
        (signer, signerKey) = makeAddrAndKey("session-signer");
    }

    function _install(uint256 expires) internal {
        vm.prank(account);
        validator.onInstall(abi.encode(sessionId, signer, expires));
    }

    function test_install_records_session() public {
        _install(block.timestamp + 3600);
        (address s, uint256 e) = validator.getSession(account, sessionId);
        assertEq(s, signer);
        assertGt(e, block.timestamp);
    }

    function test_install_revertsOnZeroSigner() public {
        vm.prank(account);
        vm.expectRevert(ECDSASessionValidator.ZeroSigner.selector);
        validator.onInstall(abi.encode(sessionId, address(0), block.timestamp + 1));
    }

    function test_install_revertsIfAlreadyAuthorized() public {
        _install(block.timestamp + 3600);
        vm.prank(account);
        vm.expectRevert();
        validator.onInstall(abi.encode(sessionId, signer, block.timestamp + 3600));
    }

    function test_validateUserOp_valid_signature_returns_success() public {
        _install(block.timestamp + 3600);
        bytes32 hash = keccak256("userop");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        PackedUserOperation memory op = _emptyUserOp();
        op.signature = sig;

        vm.prank(account);
        uint256 result = validator.validateUserOp(sessionId, op, hash);
        assertEq(result, 0, "should succeed");
    }

    function test_validateUserOp_wrong_signer_returns_failed() public {
        _install(block.timestamp + 3600);
        (, uint256 otherKey) = makeAddrAndKey("not-the-signer");
        bytes32 hash = keccak256("userop");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        PackedUserOperation memory op = _emptyUserOp();
        op.signature = sig;

        vm.prank(account);
        uint256 result = validator.validateUserOp(sessionId, op, hash);
        assertEq(result, 1, "should fail");
    }

    function test_validateUserOp_expired_returns_failed() public {
        _install(block.timestamp + 100);
        vm.warp(block.timestamp + 200);

        bytes32 hash = keccak256("userop");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        PackedUserOperation memory op = _emptyUserOp();
        op.signature = sig;

        vm.prank(account);
        uint256 result = validator.validateUserOp(sessionId, op, hash);
        assertEq(result, 1, "should fail on expiry");
    }

    function test_validateUserOp_unknown_session_returns_failed() public {
        bytes32 hash = keccak256("userop");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        PackedUserOperation memory op = _emptyUserOp();
        op.signature = sig;
        vm.prank(account);
        uint256 result = validator.validateUserOp(sessionId, op, hash);
        assertEq(result, 1, "should fail without install");
    }

    function test_uninstall_clears_session() public {
        _install(block.timestamp + 3600);
        vm.prank(account);
        validator.onUninstall(abi.encode(sessionId));
        (address s, ) = validator.getSession(account, sessionId);
        assertEq(s, address(0));
    }

    function test_isModuleType_validator_only() public view {
        assertTrue(validator.isModuleType(1));
        assertFalse(validator.isModuleType(2));
        assertFalse(validator.isModuleType(4));
    }

    function _emptyUserOp() internal pure returns (PackedUserOperation memory op) {
        op = PackedUserOperation({
            sender: address(0),
            nonce: 0,
            initCode: hex"",
            callData: hex"",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: hex"",
            signature: hex""
        });
    }
}
