// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/interfaces/IAccount.sol";

/**
 * @title IAgentAccount
 * @notice Interface for an agent-native ERC-4337 smart account.
 */
interface IAgentAccount is IAccount {
    /// @notice Emitted when an owner is added.
    event OwnerAdded(address indexed owner);

    /// @notice Emitted when an owner is removed.
    event OwnerRemoved(address indexed owner);

    /// @notice Returns true if the address is an owner.
    function isOwner(address account) external view returns (bool);

    /// @notice Returns the number of owners.
    function ownerCount() external view returns (uint256);

    /// @notice Add a new owner. Callable only by the account itself (via UserOp).
    function addOwner(address owner) external;

    /// @notice Remove an owner. Callable only by the account itself (via UserOp).
    function removeOwner(address owner) external;

    /// @notice ERC-1271: validate a signature against account owners.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}
