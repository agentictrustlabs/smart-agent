// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAttributeAuth {
    /// @notice Returns true if `actor` may write `predicate` on `subject`.
    function canWrite(bytes32 subject, bytes32 predicate, address actor) external view returns (bool);
}
