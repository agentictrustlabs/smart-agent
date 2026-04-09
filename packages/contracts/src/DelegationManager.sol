// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "./IDelegationManager.sol";
import "./ICaveatEnforcer.sol";

/**
 * @title DelegationManager
 * @notice On-chain delegation management with caveat enforcement.
 *
 * Aligned with ERC-7710 patterns and MetaMask delegation-framework design:
 * 1. Delegator signs a Delegation struct via EIP-712
 * 2. Delegate calls redeemDelegation() with the signed delegation chain
 * 3. DelegationManager validates signatures and enforces all caveats (beforeHook/afterHook)
 * 4. Execution goes through the delegator's smart account via execute()
 *
 * Key ERC-7710 / DeleGator alignments:
 * - Caveat args: redeemer-provided runtime arguments (excluded from delegation hash)
 * - beforeHook/afterHook: enforcers revert on failure (no bool return)
 * - Execute through delegator account, not direct target.call
 * - Open delegations: delegate = address(0xa11) allows any redeemer
 */
contract DelegationManager is IDelegationManager {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @dev Root authority constant — delegations with this authority are root-level
    bytes32 public constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    /// @dev Open delegation sentinel — any address can redeem
    address public constant OPEN_DELEGATION = address(0xa11);

    /// @dev EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @dev Delegation type hash for EIP-712
    bytes32 public constant DELEGATION_TYPEHASH = keccak256(
        "Delegation(address delegator,address delegate,bytes32 authority,bytes32 caveatsHash,uint256 salt)"
    );

    /// @dev Caveat type hash for EIP-712 (only enforcer + terms; args excluded)
    bytes32 public constant CAVEAT_TYPEHASH = keccak256(
        "Caveat(address enforcer,bytes terms)"
    );

    /// @dev Revoked delegation hashes
    mapping(bytes32 => bool) private _revoked;

    error DelegationRevoked_();
    error InvalidSignature();
    error InvalidAuthority();
    error OnlyDelegator();
    error ExecutionFailed();
    error InvalidDelegate();
    error EmptyChain();

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgentDelegationManager"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @inheritdoc IDelegationManager
    function redeemDelegation(
        Delegation[] calldata delegations,
        address target,
        uint256 value,
        bytes calldata data
    ) external {
        if (delegations.length == 0) revert EmptyChain();

        // Phase 1: Validate chain + run beforeHooks (leaf to root)
        for (uint256 i = 0; i < delegations.length; i++) {
            _validateDelegation(delegations, i);
            _runBeforeHooks(delegations[i], target, value, data);
        }

        // Phase 2: Execute through the root delegator's smart account
        address rootDelegator = delegations[delegations.length - 1].delegator;
        _executeFromDelegator(rootDelegator, target, value, data);

        // Phase 3: After-hooks (root to leaf, per DeleGator convention)
        for (uint256 i = delegations.length; i > 0; i--) {
            _runAfterHooks(delegations[i - 1], target, value, data);
        }
    }

    /// @inheritdoc IDelegationManager
    function revokeDelegation(bytes32 delegationHash) external {
        _revoked[delegationHash] = true;
        emit DelegationRevoked(delegationHash);
    }

    /// @inheritdoc IDelegationManager
    function isRevoked(bytes32 delegationHash) external view returns (bool) {
        return _revoked[delegationHash];
    }

    /// @notice Compute the EIP-712 hash of a delegation.
    function hashDelegation(Delegation calldata d) public view returns (bytes32) {
        bytes32 caveatsHash = _hashCaveats(d.caveats);
        bytes32 structHash = keccak256(
            abi.encode(
                DELEGATION_TYPEHASH,
                d.delegator,
                d.delegate,
                d.authority,
                caveatsHash,
                d.salt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    // ─── Internal: Validation ──────────────────────────────────────────

    function _validateDelegation(
        Delegation[] calldata delegations,
        uint256 i
    ) internal {
        Delegation calldata d = delegations[i];
        bytes32 dHash = hashDelegation(d);

        // Check not revoked
        if (_revoked[dHash]) revert DelegationRevoked_();

        // Validate delegate
        if (i == 0) {
            if (d.delegate != OPEN_DELEGATION && d.delegate != msg.sender) revert InvalidDelegate();
        } else {
            if (d.delegate != OPEN_DELEGATION && d.delegate != delegations[i - 1].delegator) revert InvalidDelegate();
        }

        // Validate authority chain
        if (d.authority != ROOT_AUTHORITY) {
            if (i + 1 >= delegations.length) revert InvalidAuthority();
            bytes32 parentHash = hashDelegation(delegations[i + 1]);
            if (d.authority != parentHash) revert InvalidAuthority();
        }

        // Validate signature
        _validateSignature(d.delegator, dHash, d.signature);

        emit DelegationRedeemed(dHash, d.delegator, d.delegate);
    }

    // ─── Internal: Caveat Hooks ────────────────────────────────────────

    function _runBeforeHooks(
        Delegation calldata d,
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        bytes32 dHash = hashDelegation(d);
        for (uint256 j = 0; j < d.caveats.length; j++) {
            ICaveatEnforcer(d.caveats[j].enforcer).beforeHook(
                d.caveats[j].terms,
                d.caveats[j].args,
                dHash,
                d.delegator,
                msg.sender,
                target,
                value,
                data
            );
        }
    }

    function _runAfterHooks(
        Delegation calldata d,
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        bytes32 dHash = hashDelegation(d);
        for (uint256 j = 0; j < d.caveats.length; j++) {
            ICaveatEnforcer(d.caveats[j].enforcer).afterHook(
                d.caveats[j].terms,
                d.caveats[j].args,
                dHash,
                d.delegator,
                msg.sender,
                target,
                value,
                data
            );
        }
    }

    // ─── Internal: Execution ───────────────────────────────────────────

    function _executeFromDelegator(
        address delegator,
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        // Call the delegator account's execute(address,uint256,bytes) function
        // This ensures msg.sender in the target contract is the delegator
        (bool success, bytes memory returnData) = delegator.call(
            abi.encodeWithSignature("execute(address,uint256,bytes)", target, value, data)
        );
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert ExecutionFailed();
        }
    }

    // ─── Internal: Signature ───────────────────────────────────────────

    function _validateSignature(
        address signer,
        bytes32 digest,
        bytes calldata signature
    ) internal view {
        // ERC-1271 for smart accounts
        if (signer.code.length > 0) {
            bytes4 result = IERC1271(signer).isValidSignature(digest, signature);
            if (result != IERC1271.isValidSignature.selector) revert InvalidSignature();
            return;
        }
        // EOA — recover from eth-signed message hash
        bytes32 ethHash = digest.toEthSignedMessageHash();
        address recovered = ethHash.recover(signature);
        if (recovered != signer) revert InvalidSignature();
    }

    // ─── Internal: Hashing ─────────────────────────────────────────────

    function _hashCaveats(Caveat[] calldata caveats) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](caveats.length);
        for (uint256 i = 0; i < caveats.length; i++) {
            hashes[i] = keccak256(
                abi.encode(CAVEAT_TYPEHASH, caveats[i].enforcer, keccak256(caveats[i].terms))
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }
}
