// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./P256Verifier.sol";

/**
 * @title WebAuthnLib
 * @notice Pure-computation library for verifying a WebAuthn assertion against
 *         an expected challenge hash and a registered P-256 public key.
 *
 *   Reconstructs the signing message:
 *     signingMessage = authenticatorData || sha256(clientDataJSON)
 *     signingHash    = sha256(signingMessage)
 *
 *   Checks:
 *     - clientDataJSON contains "type":"webauthn.get" at typeIndex.
 *     - clientDataJSON contains "challenge":"<base64url(expectedHash)>" at challengeIndex.
 *     - P256Verifier.verify(signingHash, r, s, x, y) returns true.
 *
 *   Used by both AgentAccount (native passkey path) and the standalone
 *   PasskeyValidator (for external 1271-style verification).
 */
library WebAuthnLib {
    /// @notice A WebAuthn-wrapped P-256 signature bundle.
    struct Assertion {
        bytes   authenticatorData;
        string  clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        uint256 r;
        uint256 s;
        bytes32 credentialIdDigest;
    }

    /// @notice Verify that `assertion` is a valid WebAuthn signature over
    ///         `expectedChallengeHash` produced by `(pubX, pubY)`.
    function verify(
        Assertion memory assertion,
        bytes32 expectedChallengeHash,
        uint256 pubX,
        uint256 pubY
    ) internal view returns (bool) {
        if (!_checkClientData(assertion.clientDataJSON, assertion.typeIndex, assertion.challengeIndex, expectedChallengeHash)) {
            return false;
        }
        bytes32 cdjHash = sha256(bytes(assertion.clientDataJSON));
        bytes32 signingHash = sha256(abi.encodePacked(assertion.authenticatorData, cdjHash));
        return P256Verifier.verify(signingHash, assertion.r, assertion.s, pubX, pubY);
    }

    /// @dev Validates the two structural invariants of clientDataJSON:
    ///      (1) starts with `"type":"webauthn.get"` at typeIndex
    ///      (2) has `"challenge":"<base64url(hash)>"` at challengeIndex.
    function _checkClientData(
        string memory cdj,
        uint256 typeIndex,
        uint256 challengeIndex,
        bytes32 hash
    ) private pure returns (bool) {
        bytes memory buf = bytes(cdj);
        bytes memory typeExpected = bytes('"type":"webauthn.get"');
        if (typeIndex + typeExpected.length > buf.length) return false;
        for (uint256 i; i < typeExpected.length; i++) {
            if (buf[typeIndex + i] != typeExpected[i]) return false;
        }
        bytes memory challengePrefix = bytes('"challenge":"');
        if (challengeIndex + challengePrefix.length + 43 + 1 > buf.length) return false;
        for (uint256 i; i < challengePrefix.length; i++) {
            if (buf[challengeIndex + i] != challengePrefix[i]) return false;
        }
        if (buf[challengeIndex + challengePrefix.length + 43] != bytes1('"')) return false;

        // Decode the 43 base64url chars that follow the prefix and compare to `hash`.
        return _base64UrlEqualsHash(buf, challengeIndex + challengePrefix.length, hash);
    }

    /// @dev Read 43 base64url chars starting at `offset` in `buf`, decode, and
    ///      assert the 32 decoded bytes equal `hash`.
    function _base64UrlEqualsHash(bytes memory buf, uint256 offset, bytes32 hash) private pure returns (bool) {
        uint256 acc;
        uint256 bits;
        uint256 outIdx;
        bytes memory decoded = new bytes(32);
        for (uint256 i; i < 43; i++) {
            int256 v = _b64UrlCharVal(buf[offset + i]);
            if (v < 0) return false;
            acc = (acc << 6) | uint256(v);
            bits += 6;
            while (bits >= 8 && outIdx < 32) {
                bits -= 8;
                decoded[outIdx++] = bytes1(uint8((acc >> bits) & 0xff));
            }
        }
        if (outIdx != 32) return false;
        for (uint256 i; i < 32; i++) {
            if (decoded[i] != hash[i]) return false;
        }
        return true;
    }

    function _b64UrlCharVal(bytes1 c) private pure returns (int256) {
        uint8 b = uint8(c);
        if (b >= 0x41 && b <= 0x5a) return int256(uint256(b - 0x41));
        if (b >= 0x61 && b <= 0x7a) return int256(uint256(b - 0x61 + 26));
        if (b >= 0x30 && b <= 0x39) return int256(uint256(b - 0x30 + 52));
        if (b == 0x2d) return 62;
        if (b == 0x5f) return 63;
        return -1;
    }
}
