// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IGovernanceView
/// @notice Minimal read surface every `GovernanceManaged` contract depends
///         on. The pause flag flows through here so we can short-circuit
///         writes without pulling in the whole governance type.
interface IGovernanceView {
    /// @notice Global system-pause flag.
    function isPaused() external view returns (bool);

    /// @notice Whether `who` is currently authorised to call `emergencyPause`
    ///         on behalf of governance (i.e. they're an active signer).
    function isSigner(address who) external view returns (bool);
}
