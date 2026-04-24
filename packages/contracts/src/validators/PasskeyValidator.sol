// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "../modules/IERC7579Module.sol";

/**
 * @title PasskeyValidator
 * @notice Per-account registry of WebAuthn passkey credentials and
 *         signature verification for ERC-4337 UserOps / ERC-1271 messages.
 *
 *   Each smart account (msg.sender of a register/remove call) owns a map of
 *   credentialId → (x, y) P-256 public key. Callers submit the WebAuthn
 *   assertion (authenticatorData + clientDataJSON + P-256 sig) and the
 *   validator rebuilds the signing message, then verifies via the
 *   RIP-7212 P-256 precompile at address 0x100.
 *
 *   RIP-7212 input layout (160 bytes): msgHash(32) || r(32) || s(32) || x(32) || y(32)
 *   Output: 32 bytes — 0x...01 on valid, empty on invalid.
 *
 *   Chains that support RIP-7212 include: Base, Optimism Odyssey, Polygon zkEVM,
 *   Arbitrum Nitro ≥2.5, Linea, Scroll, and any foundry/anvil node started
 *   with --odyssey. For chains without it, this contract still compiles and
 *   can be upgraded by swapping the verifier to a pure-Solidity P-256 impl.
 *
 *   Privacy: the credentialId is stored as a keccak digest, not the raw bytes —
 *   the raw id never lands on-chain. Callers pass the digest when signing.
 */
contract PasskeyValidator is IERC7579Module {
    // ─── ERC-7579 Marker ──────────────────────────────────────────────
    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == SmartAgentModuleTypes.TYPE_VALIDATOR;
    }

    function moduleId() external pure override returns (string memory) {
        return "smart-agent-passkey-validator-1";
    }

    address private constant P256_PRECOMPILE = address(0x100);
    bytes4  private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4  private constant ERC1271_INVALID     = 0xffffffff;

    struct PubKey {
        uint256 x;
        uint256 y;
    }

    // account => credentialIdDigest => pubkey
    mapping(address => mapping(bytes32 => PubKey)) private _keys;
    // account => set membership (iterable-ish via events)
    mapping(address => mapping(bytes32 => bool)) private _registered;
    // account => count (cheap gate for "has any passkey")
    mapping(address => uint256) private _count;

    event PasskeyRegistered(address indexed account, bytes32 indexed credentialIdDigest, uint256 x, uint256 y);
    event PasskeyRemoved(address indexed account, bytes32 indexed credentialIdDigest);

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidPublicKey();
    error InvalidSignature();
    error InvalidClientData();
    error PrecompileUnavailable();

    // ─── Registration ──────────────────────────────────────────────────

    /// @notice Register a WebAuthn credential for msg.sender's account.
    /// @param credentialIdDigest keccak256 of the raw credentialId bytes.
    /// @param x                   P-256 public key X coordinate.
    /// @param y                   P-256 public key Y coordinate.
    function register(bytes32 credentialIdDigest, uint256 x, uint256 y) external {
        if (x == 0 || y == 0) revert InvalidPublicKey();
        if (_registered[msg.sender][credentialIdDigest]) revert AlreadyRegistered();
        _keys[msg.sender][credentialIdDigest] = PubKey(x, y);
        _registered[msg.sender][credentialIdDigest] = true;
        _count[msg.sender] += 1;
        emit PasskeyRegistered(msg.sender, credentialIdDigest, x, y);
    }

    function remove(bytes32 credentialIdDigest) external {
        if (!_registered[msg.sender][credentialIdDigest]) revert NotRegistered();
        delete _keys[msg.sender][credentialIdDigest];
        _registered[msg.sender][credentialIdDigest] = false;
        _count[msg.sender] -= 1;
        emit PasskeyRemoved(msg.sender, credentialIdDigest);
    }

    // ─── Views ─────────────────────────────────────────────────────────

    function hasCredential(address account, bytes32 credentialIdDigest) external view returns (bool) {
        return _registered[account][credentialIdDigest];
    }

    function getPubKey(address account, bytes32 credentialIdDigest) external view returns (uint256 x, uint256 y) {
        PubKey storage k = _keys[account][credentialIdDigest];
        return (k.x, k.y);
    }

    function count(address account) external view returns (uint256) {
        return _count[account];
    }

    // ─── Verification ──────────────────────────────────────────────────

    /**
     * @notice A WebAuthn-wrapped signature package.
     *
     *   authenticatorData    — raw WebAuthn authenticator data bytes.
     *   clientDataJSON       — raw client data JSON bytes. MUST contain the
     *                          challenge field as base64url(hash).
     *   challengeIndex       — byte index of the challenge-value string in
     *                          clientDataJSON (off-chain helper fills this).
     *   typeIndex            — byte index of the type-value string.
     *   r, s                 — P-256 signature components.
     *   credentialIdDigest   — keccak of the credentialId used.
     */
    struct Assertion {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        uint256 r;
        uint256 s;
        bytes32 credentialIdDigest;
    }

    /**
     * @notice Verify a WebAuthn assertion over `hash` for `account`'s passkey.
     * @return true iff the signature is valid.
     */
    function verify(address account, bytes32 hash, Assertion calldata a) public view returns (bool) {
        PubKey storage k = _keys[account][a.credentialIdDigest];
        if (k.x == 0 && k.y == 0) return false;

        // 1. clientDataJSON must assert type=webauthn.get at typeIndex and
        //    include challenge=base64url(hash) at challengeIndex.
        if (!_checkClientData(a.clientDataJSON, a.typeIndex, a.challengeIndex, hash)) {
            return false;
        }

        // 2. signingMessage = authenticatorData || sha256(clientDataJSON)
        bytes32 cdjHash = sha256(bytes(a.clientDataJSON));
        bytes32 signingHash = sha256(abi.encodePacked(a.authenticatorData, cdjHash));

        // 3. Call RIP-7212 P-256 precompile.
        return _p256Verify(signingHash, a.r, a.s, k.x, k.y);
    }

    /**
     * @notice ERC-1271-style signature validation.
     * @dev `signature` is abi.encode(Assertion).
     */
    function isValidSignature(address account, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        Assertion memory a = abi.decode(signature, (Assertion));
        // shallow-copy into calldata-compatible call via a tuple; re-encode.
        // (Solidity can't pass memory struct to `verify` with calldata sig, so
        //  we do the work inline here.)
        PubKey storage k = _keys[account][a.credentialIdDigest];
        if (k.x == 0 && k.y == 0) return ERC1271_INVALID;
        if (!_checkClientData(a.clientDataJSON, a.typeIndex, a.challengeIndex, hash)) return ERC1271_INVALID;
        bytes32 cdjHash = sha256(bytes(a.clientDataJSON));
        bytes32 signingHash = sha256(abi.encodePacked(a.authenticatorData, cdjHash));
        return _p256Verify(signingHash, a.r, a.s, k.x, k.y) ? ERC1271_MAGIC_VALUE : ERC1271_INVALID;
    }

    // ─── Internals ─────────────────────────────────────────────────────

    /// @dev True iff clientDataJSON[typeIndex:] starts with `"type":"webauthn.get"`
    ///      and clientDataJSON[challengeIndex:] starts with `"challenge":"<base64url(hash)>"`.
    function _checkClientData(
        string memory cdj,
        uint256 typeIndex,
        uint256 challengeIndex,
        bytes32 hash
    ) internal pure returns (bool) {
        bytes memory buf = bytes(cdj);
        // "type":"webauthn.get" — 21 chars
        bytes memory typeExpected = bytes('"type":"webauthn.get"');
        if (typeIndex + typeExpected.length > buf.length) return false;
        for (uint256 i; i < typeExpected.length; i++) {
            if (buf[typeIndex + i] != typeExpected[i]) return false;
        }
        // "challenge":"<43 base64url chars for 32 bytes>"
        bytes memory challengePrefix = bytes('"challenge":"');
        if (challengeIndex + challengePrefix.length + 43 + 1 > buf.length) return false;
        for (uint256 i; i < challengePrefix.length; i++) {
            if (buf[challengeIndex + i] != challengePrefix[i]) return false;
        }
        // Decode the 43 base64url chars that follow and compare to `hash`.
        bytes memory encoded = new bytes(43);
        for (uint256 i; i < 43; i++) {
            encoded[i] = buf[challengeIndex + challengePrefix.length + i];
        }
        // Trailing quote
        if (buf[challengeIndex + challengePrefix.length + 43] != bytes1('"')) return false;
        return _base64UrlEqualsHash(encoded, hash);
    }

    /// @dev Decode 43 base64url chars (no padding) and compare to a 32-byte hash.
    function _base64UrlEqualsHash(bytes memory enc, bytes32 hash) internal pure returns (bool) {
        // 43 base64url chars decode to 32 bytes (with 4 bits of trailing padding).
        // We rebuild the 32 decoded bytes and compare.
        if (enc.length != 43) return false;
        uint256 acc;
        uint256 bits;
        uint256 outIdx;
        bytes memory decoded = new bytes(32);
        for (uint256 i; i < 43; i++) {
            int256 v = _b64UrlCharVal(enc[i]);
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

    function _b64UrlCharVal(bytes1 c) internal pure returns (int256) {
        uint8 b = uint8(c);
        if (b >= 0x41 && b <= 0x5a) return int256(uint256(b - 0x41));          // A-Z  → 0-25
        if (b >= 0x61 && b <= 0x7a) return int256(uint256(b - 0x61 + 26));     // a-z  → 26-51
        if (b >= 0x30 && b <= 0x39) return int256(uint256(b - 0x30 + 52));     // 0-9  → 52-61
        if (b == 0x2d) return 62;                                              // '-'  → 62
        if (b == 0x5f) return 63;                                              // '_'  → 63
        return -1;
    }

    function _p256Verify(bytes32 h, uint256 r, uint256 s, uint256 x, uint256 y) internal view returns (bool) {
        (bool ok, bytes memory ret) = P256_PRECOMPILE.staticcall(
            abi.encodePacked(h, r, s, x, y)
        );
        if (!ok) return false;
        if (ret.length < 32) return false;
        return uint256(bytes32(ret)) == 1;
    }
}
