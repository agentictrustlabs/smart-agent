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
 * Delegation flow:
 * 1. Delegator signs a Delegation struct via EIP-712
 * 2. Delegate calls redeemDelegation() with the signed delegation chain
 * 3. DelegationManager validates signatures and enforces all caveats
 * 4. If all caveats pass, executes the target call as the delegator
 */
contract DelegationManager is IDelegationManager {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @dev Root authority constant — delegations with this authority are root-level
    bytes32 public constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    /// @dev EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @dev Delegation type hash for EIP-712
    bytes32 public constant DELEGATION_TYPEHASH = keccak256(
        "Delegation(address delegator,address delegate,bytes32 authority,bytes32 caveatsHash,uint256 salt)"
    );

    /// @dev Caveat type hash for EIP-712
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
    error CaveatViolation(address enforcer);

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
        // Validate the delegation chain from leaf to root
        for (uint256 i = 0; i < delegations.length; i++) {
            Delegation calldata d = delegations[i];
            bytes32 dHash = hashDelegation(d);

            // Check not revoked
            if (_revoked[dHash]) revert DelegationRevoked_();

            // Validate authority chain
            if (i == 0) {
                // First delegation must be root or reference a parent
                if (d.authority != ROOT_AUTHORITY) {
                    // authority must match the hash of the next delegation in chain
                    if (i + 1 >= delegations.length) revert InvalidAuthority();
                    bytes32 parentHash = hashDelegation(delegations[i + 1]);
                    if (d.authority != parentHash) revert InvalidAuthority();
                }
            }

            // Validate signature (EIP-712 or ERC-1271)
            _validateSignature(d.delegator, dHash, d.signature);

            // Enforce all caveats
            for (uint256 j = 0; j < d.caveats.length; j++) {
                Caveat calldata caveat = d.caveats[j];
                bool allowed = ICaveatEnforcer(caveat.enforcer).enforceCaveat(
                    caveat.terms,
                    msg.sender,
                    target,
                    value,
                    data
                );
                if (!allowed) revert CaveatViolation(caveat.enforcer);
            }

            emit DelegationRedeemed(dHash, d.delegator, d.delegate);
        }

        // Execute on behalf of the root delegator
        address rootDelegator = delegations[delegations.length - 1].delegator;
        (bool success,) = target.call{value: value}(data);
        if (!success) revert ExecutionFailed();
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

        return keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );
    }

    function _hashCaveats(Caveat[] calldata caveats) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](caveats.length);
        for (uint256 i = 0; i < caveats.length; i++) {
            hashes[i] = keccak256(
                abi.encode(
                    CAVEAT_TYPEHASH,
                    caveats[i].enforcer,
                    keccak256(caveats[i].terms)
                )
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _validateSignature(
        address signer,
        bytes32 digest,
        bytes calldata signature
    ) internal view {
        // Try ERC-1271 first (smart account)
        if (signer.code.length > 0) {
            bytes4 result = IERC1271(signer).isValidSignature(digest, signature);
            if (result != IERC1271.isValidSignature.selector) revert InvalidSignature();
            return;
        }

        // EOA signature
        bytes32 ethHash = digest.toEthSignedMessageHash();
        address recovered = ethHash.recover(signature);
        if (recovered != signer) revert InvalidSignature();
    }
}
