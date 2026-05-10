// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579ModuleLifecycle, SmartAgentModuleTypes} from "./IERC7579Module.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";

/**
 * @title ECDSASessionValidator
 * @notice ERC-7579 Validator module (type 1) that authorizes a 4337
 *         UserOperation iff it is signed by a session-bound EOA inside an
 *         expiry window. Multiple accounts can install the same module
 *         instance — state is keyed by `msg.sender` so installs are isolated.
 *
 *   Init data shape:
 *     abi.encode(bytes32 sessionId, address expectedSigner, uint256 expiresAt)
 *
 *   Deinit data shape:
 *     abi.encode(bytes32 sessionId)
 *
 *   validateUserOp returns:
 *     0 (SIG_VALIDATION_SUCCESS) on valid signer + non-expired window
 *     1 (SIG_VALIDATION_FAILED) otherwise (NEVER revert — bundler-friendly)
 *
 * This validator is designed for Phase 3 SessionAgentAccounts. The session
 * EOA in a2a-agent signs userOps; this module gates them so the master EOA
 * doesn't need to be touched for every call.
 */
contract ECDSASessionValidator is IERC7579ModuleLifecycle {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @dev SIG_VALIDATION result codes (ERC-4337).
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED  = 1;

    struct SessionAuthorization {
        address expectedSigner;
        uint256 expiresAt;
    }

    /// @dev (account => sessionId => authorization). One account may hold
    ///      multiple session sigs (e.g., a primary + a recovery), so we key
    ///      by sessionId rather than overwriting per account.
    mapping(address => mapping(bytes32 => SessionAuthorization)) private _sessions;

    event SessionAuthorized(address indexed account, bytes32 indexed sessionId, address signer, uint256 expiresAt);
    event SessionRevoked(address indexed account, bytes32 indexed sessionId);

    error InvalidInitData();
    error SessionAlreadyAuthorized(bytes32 sessionId);
    error SessionNotAuthorized(bytes32 sessionId);
    error ZeroSigner();

    // ─── IERC7579Module ──────────────────────────────────────────────

    function onInstall(bytes calldata data) external override {
        if (data.length == 0) revert InvalidInitData();
        (bytes32 sessionId, address expectedSigner, uint256 expiresAt) =
            abi.decode(data, (bytes32, address, uint256));
        if (expectedSigner == address(0)) revert ZeroSigner();
        if (_sessions[msg.sender][sessionId].expectedSigner != address(0)) {
            revert SessionAlreadyAuthorized(sessionId);
        }
        _sessions[msg.sender][sessionId] = SessionAuthorization(expectedSigner, expiresAt);
        emit SessionAuthorized(msg.sender, sessionId, expectedSigner, expiresAt);
    }

    function onUninstall(bytes calldata data) external override {
        bytes32 sessionId;
        if (data.length >= 32) {
            sessionId = abi.decode(data, (bytes32));
        }
        // Tolerate empty deinit data → clear the only session (if exactly one).
        // For Phase 3, callers should always pass the sessionId explicitly.
        if (sessionId == bytes32(0)) revert InvalidInitData();
        if (_sessions[msg.sender][sessionId].expectedSigner == address(0)) {
            revert SessionNotAuthorized(sessionId);
        }
        delete _sessions[msg.sender][sessionId];
        emit SessionRevoked(msg.sender, sessionId);
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_VALIDATOR;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent.ecdsa-session-validator.1";
    }

    // ─── Validator surface ───────────────────────────────────────────

    /// @notice Validate a userOp against the session signer pinned for `account`.
    /// @dev Called by SessionAgentAccount's _validateSignature when this
    ///      validator is the active one for the userOp. NEVER reverts — uses
    ///      the SIG_VALIDATION return code so the EntryPoint can short-circuit
    ///      a bad signature without burning bundler simulation budget.
    function validateUserOp(
        bytes32 sessionId,
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external view returns (uint256) {
        SessionAuthorization memory s = _sessions[msg.sender][sessionId];
        if (s.expectedSigner == address(0)) return SIG_VALIDATION_FAILED;
        if (s.expiresAt != 0 && block.timestamp > s.expiresAt) return SIG_VALIDATION_FAILED;

        // Accept raw-hash ECDSA OR eth-signed-message wrap, mirroring AgentAccount's
        // _verifyEcdsa shape.
        (address rec1, ECDSA.RecoverError err1,) = ECDSA.tryRecover(userOpHash, userOp.signature);
        if (err1 == ECDSA.RecoverError.NoError && rec1 == s.expectedSigner) return SIG_VALIDATION_SUCCESS;
        bytes32 ethSigned = userOpHash.toEthSignedMessageHash();
        (address rec2, ECDSA.RecoverError err2,) = ECDSA.tryRecover(ethSigned, userOp.signature);
        if (err2 == ECDSA.RecoverError.NoError && rec2 == s.expectedSigner) return SIG_VALIDATION_SUCCESS;
        return SIG_VALIDATION_FAILED;
    }

    function getSession(address account, bytes32 sessionId)
        external view returns (address expectedSigner, uint256 expiresAt)
    {
        SessionAuthorization memory s = _sessions[account][sessionId];
        return (s.expectedSigner, s.expiresAt);
    }
}
