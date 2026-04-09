// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDelegationManager
 * @notice Manages delegations between agent accounts with caveat enforcement.
 *
 * Inspired by ERC-7710 delegation patterns:
 * - A delegation grants a delegate the right to act on behalf of a delegator
 * - Caveats constrain what the delegate can do (time, value, methods, targets)
 * - Delegations can be chained: A delegates to B, B delegates to C
 * - Revocation is immediate and on-chain
 */
interface IDelegationManager {
    struct Caveat {
        address enforcer;   // contract that validates this caveat
        bytes terms;        // encoded parameters for the enforcer
    }

    struct Delegation {
        address delegator;  // account granting authority
        address delegate;   // account receiving authority
        bytes32 authority;  // parent delegation hash (ROOT_AUTHORITY for root)
        Caveat[] caveats;   // restrictions on the delegation
        uint256 salt;       // replay protection
        bytes signature;    // EIP-712 signature from delegator
    }

    /// @notice Emitted when a delegation is redeemed.
    event DelegationRedeemed(
        bytes32 indexed delegationHash,
        address indexed delegator,
        address indexed delegate
    );

    /// @notice Emitted when a delegation is revoked.
    event DelegationRevoked(bytes32 indexed delegationHash);

    /// @notice Redeem a delegation chain to execute an action on behalf of the delegator.
    function redeemDelegation(
        Delegation[] calldata delegations,
        address target,
        uint256 value,
        bytes calldata data
    ) external;

    /// @notice Revoke a delegation by its hash.
    function revokeDelegation(bytes32 delegationHash) external;

    /// @notice Check if a delegation has been revoked.
    function isRevoked(bytes32 delegationHash) external view returns (bool);
}
