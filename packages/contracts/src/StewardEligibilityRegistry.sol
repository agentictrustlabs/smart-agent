// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title StewardEligibilityRegistry
 * @notice Per-pool current steward set + per-steward eligibility flag.
 *         Borrowed from Hats Protocol's `IHatsEligibility` shape, adapted
 *         to our pool model.
 *
 * @dev The motivation (per output/dao-pool-round-best-practices.md § 3 Q3
 *      and output/safe-architecture-comparison.md § 3 Q6) is to avoid
 *      re-minting STEWARDSHIP_DELEGATION on every steward rotation.
 *      Instead, `StewardEligibilityEnforcer` reads `isEligible` at
 *      sig-verification time; flipping a steward's eligibility is a
 *      single SSTORE, and revocation cascades automatically.
 *
 *      Auth: only the Pool itself (msg.sender == pool) can update its
 *      eligibility set. Same rationale as MandateRegistry — a steward
 *      mutation must come through a redeemed delegation.
 *
 *      Mirror class assertion: `sa:StewardSetUpdatedAssertion`.
 */
contract StewardEligibilityRegistry {
    error NotPool();

    /// pool => steward => is eligible
    mapping(address => mapping(address => bool)) public eligibility;

    /// pool => steward => seen-before (for de-duplicating the ordered list when
    /// a removed steward gets re-eligibilized)
    mapping(address => mapping(address => bool)) internal _seen;

    /// pool => steward set (ordered list; iteration index tracked separately)
    mapping(address => address[]) internal _stewards;

    /// pool => threshold (N-of-M)
    mapping(address => uint8) public threshold;

    event StewardEligibilityChanged(address indexed pool, address indexed steward, bool eligible);
    event ThresholdChanged(address indexed pool, uint8 threshold);

    /**
     * @notice Flip a steward's eligibility. Adding a previously-unknown
     *         steward also appends them to the ordered list; removing
     *         leaves them in the list with `eligibility[steward] = false`
     *         (cheap; readers must filter on `isEligible`).
     */
    function setSteward(address pool, address steward, bool eligible) external {
        if (msg.sender != pool) revert NotPool();
        eligibility[pool][steward] = eligible;
        // Append to the ordered list only the FIRST time a steward is added.
        // Subsequent eligibility flips (false → true again) skip the push so
        // we never accumulate duplicates in `_stewards`.
        if (eligible && !_seen[pool][steward]) {
            _seen[pool][steward] = true;
            _stewards[pool].push(steward);
        }
        emit StewardEligibilityChanged(pool, steward, eligible);
    }

    function setThreshold(address pool, uint8 newThreshold) external {
        if (msg.sender != pool) revert NotPool();
        threshold[pool] = newThreshold;
        emit ThresholdChanged(pool, newThreshold);
    }

    /// @notice Cheap eligibility lookup used by StewardEligibilityEnforcer.
    function isEligible(address pool, address steward) external view returns (bool) {
        return eligibility[pool][steward];
    }

    /// @notice Returns the (eligibility-filtered) steward list for a pool.
    ///         Off-chain callers prefer this over reading _stewards directly
    ///         because `_stewards` may carry de-flagged entries.
    function getEligibleStewards(address pool) external view returns (address[] memory active, uint8 t) {
        address[] storage all = _stewards[pool];
        uint256 n = all.length;
        // First pass: count.
        uint256 count;
        for (uint256 i; i < n; i++) {
            if (eligibility[pool][all[i]]) count++;
        }
        // Second pass: fill.
        active = new address[](count);
        uint256 j;
        for (uint256 i; i < n; i++) {
            if (eligibility[pool][all[i]]) {
                active[j++] = all[i];
            }
        }
        t = threshold[pool];
    }
}
