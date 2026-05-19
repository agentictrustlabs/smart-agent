// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../../src/governance/Governance.sol";

/**
 * @title GovernanceFixture
 * @notice Test helper that deploys a `Governance` contract with sane
 *         defaults for Foundry tests. Most tests don't exercise the
 *         governance flow — they just need a non-zero `governance`
 *         address that satisfies the `GovernanceManaged` constructor
 *         and answers `isPaused()` with `false`.
 *
 *         For tests that DO exercise governance, use
 *         `deployGovernanceWithSigner(signer)` to get a 1-of-1
 *         governance with a known signer EOA, then drive proposals
 *         through it directly.
 */
library GovernanceFixture {
    /// @notice Deploy a permissive 1-of-1 governance whose only signer
    ///         is `signer`. Timelock is 0 (instant execute) so dev / unit
    ///         tests aren't waiting wall-clock seconds.
    function deployWithSigner(address signer) internal returns (Governance gov) {
        address[] memory signers = new address[](1);
        signers[0] = signer;
        gov = new Governance(signers, 1, 1, 0, true);
    }

    /// @notice Deploy a permissive 5-of-9 governance. Returns the gov
    ///         AND the 9 signer addresses + their private keys (test-
    ///         deterministic, derived from `seed`) so tests can sign
    ///         emergency-pause bundles.
    function deployFiveOfNine(uint256 seed)
        internal
        returns (Governance gov, address[9] memory signers, uint256[9] memory keys)
    {
        address[] memory dyn = new address[](9);
        for (uint256 i = 0; i < 9; i++) {
            keys[i] = uint256(keccak256(abi.encode("gov-fixture-signer", seed, i)));
            signers[i] = vmAddr(keys[i]);
            dyn[i] = signers[i];
        }
        gov = new Governance(dyn, 5, 9, 0, true);
    }

    /// @dev Local `vm.addr` shim so we don't need to import forge-std
    ///      into a library. Uses the standard cheatcode address.
    function vmAddr(uint256 privateKey) private view returns (address) {
        // SECP256K1 derivation via the Vm cheatcode. We can't call it
        // from a library purely (libraries can't access state), so we
        // resort to an assembly staticcall against the cheatcode address.
        // Cheatcode addr: 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D.
        address cheats = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;
        (bool ok, bytes memory ret) = cheats.staticcall(
            abi.encodeWithSignature("addr(uint256)", privateKey)
        );
        require(ok && ret.length == 32, "GovernanceFixture: addr failed");
        return abi.decode(ret, (address));
    }
}
