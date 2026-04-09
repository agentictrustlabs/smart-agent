// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDelegationManager
 * @notice Manages delegations between agent accounts with caveat enforcement.
 *
 * Aligned with ERC-7710 (Smart Contract Delegation) patterns and inspired by
 * MetaMask delegation-framework:
 * - A delegation grants a delegate the right to act on behalf of a delegator
 * - Caveats constrain what the delegate can do (time, value, methods, targets)
 * - Delegations can be chained: A delegates to B, B delegates to C
 * - Revocation is immediate and on-chain
 * - Execution goes through the delegator's smart account (executeFromExecutor)
 *
 * ERC-7710 defines: redeemDelegations(bytes[], bytes32[], bytes[])
 * We provide both the typed `redeemDelegation` and the ERC-7710 opaque interface.
 */
interface IDelegationManager {
    struct Caveat {
        address enforcer;   // contract that validates this caveat
        bytes terms;        // encoded parameters set at delegation creation time
        bytes args;         // encoded parameters provided by redeemer at redemption time
    }

    struct Delegation {
        address delegator;  // account granting authority
        address delegate;   // account receiving authority (address(0xa11) = open delegation)
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
    ///         The delegator's smart account executes the call via executeFromExecutor.
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
