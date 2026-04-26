// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/P256.sol";

/**
 * @title DaimoP256Verifier
 * @notice ABI-compatible drop-in for Daimo's canonical P256Verifier
 *         (0xc2b78104907F722DABAc4C69f826a522B2754De4 on mainnets).
 *
 * Daimo's interface — used by AgentAccount's P256Verifier library — is the
 * raw fallback contract pattern:
 *
 *   call(0xc2b7…54De4, abi.encodePacked(msgHash, r, s, x, y))
 *   returndata = abi.encodePacked(uint256(1)) iff valid, else (0)
 *
 * No function selector. The fallback inspects calldata length (160 bytes
 * exactly) and routes to OpenZeppelin's pure-Solidity P-256 implementation.
 *
 * Used in dev (where the chain has no RIP-7212 precompile and we don't want
 * to rely on the always-true stub) and in prod on chains that don't have
 * Daimo's contract pre-deployed.
 */
contract DaimoP256Verifier {
    fallback(bytes calldata data) external returns (bytes memory) {
        if (data.length != 160) {
            return abi.encode(uint256(0));
        }
        bytes32 h  = bytes32(data[0:32]);
        bytes32 r  = bytes32(data[32:64]);
        bytes32 s  = bytes32(data[64:96]);
        bytes32 x  = bytes32(data[96:128]);
        bytes32 y  = bytes32(data[128:160]);
        return abi.encode(P256.verify(h, r, s, x, y) ? uint256(1) : uint256(0));
    }
}
