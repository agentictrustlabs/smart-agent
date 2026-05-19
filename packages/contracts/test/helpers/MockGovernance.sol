// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../../src/governance/IGovernance.sol";

/**
 * @title MockGovernance
 * @notice Minimal IGovernanceView implementation for tests that need a
 *         valid governance address but don't exercise the full proposal
 *         + timelock surface.
 *
 *         Tests that DO exercise governance should deploy the real
 *         `Governance` contract instead.
 */
contract MockGovernance is IGovernanceView {
    bool public pausedFlag;
    address public signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function setPaused(bool v) external {
        pausedFlag = v;
    }

    function isPaused() external view override returns (bool) {
        return pausedFlag;
    }

    function isSigner(address who) external view override returns (bool) {
        return who == signer;
    }
}
