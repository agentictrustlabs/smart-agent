// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title P256Verifier
 * @notice Dispatcher for P-256 (secp256r1) signature verification.
 *
 *         Order of attempts:
 *           1. RIP-7212 precompile at 0x100 (Base, Polygon zkEVM, Optimism
 *              Odyssey, Arbitrum Nitro ≥2.5, Scroll, Linea, Anvil w/ --odyssey).
 *           2. Daimo P256Verifier at its canonical deterministic address
 *              0xc2b78104907F722DABAc4C69f826a522B2754De4 — a pure-Solidity
 *              fallback (~330k gas). Deploy it yourself on chains that need it.
 *           3. Returns false (neither path succeeded).
 *
 *         Input layout in both cases: msgHash(32) || r(32) || s(32) || x(32) || y(32)
 *         Output: bool — true iff the signature verifies.
 */
library P256Verifier {
    address internal constant RIP7212_PRECOMPILE = address(0x100);
    address internal constant DAIMO_VERIFIER     = 0xc2b78104907F722DABAc4C69f826a522B2754De4;

    function verify(bytes32 hash, uint256 r, uint256 s, uint256 x, uint256 y) internal view returns (bool) {
        bytes memory input = abi.encodePacked(hash, r, s, x, y);

        // 1. RIP-7212 precompile.
        (bool ok1, bytes memory out1) = RIP7212_PRECOMPILE.staticcall(input);
        if (ok1 && out1.length >= 32 && uint256(bytes32(out1)) == 1) {
            return true;
        }

        // 2. Daimo verifier (pure-Solidity P-256).
        if (DAIMO_VERIFIER.code.length > 0) {
            (bool ok2, bytes memory out2) = DAIMO_VERIFIER.staticcall(input);
            if (ok2 && out2.length >= 32 && uint256(bytes32(out2)) == 1) {
                return true;
            }
        }

        return false;
    }
}
