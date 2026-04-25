// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/validators/PasskeyValidator.sol";
import "../src/libraries/WebAuthnLib.sol";

contract PasskeyValidatorTest is Test {
    PasskeyValidator internal v;

    address internal constant P256 = address(0x100);
    address internal account = address(0xA11CE);
    bytes32 internal credentialIdDigest = keccak256("cred-1");
    uint256 internal constant X = 1;       // values don't matter; we mock the precompile
    uint256 internal constant Y = 2;

    function setUp() public {
        v = new PasskeyValidator();
    }

    function _makeClientDataJSON(bytes32 hash) internal pure returns (string memory cdj, uint256 typeIdx, uint256 challengeIdx) {
        // Build a minimal clientDataJSON that matches the checks.
        string memory encoded = _base64url32(hash);
        cdj = string(abi.encodePacked(
            '{"type":"webauthn.get","challenge":"', encoded, '","origin":"https://example.org","crossOrigin":false}'
        ));
        // '{' at index 0, '"type":' at index 1
        typeIdx = 1;
        challengeIdx = 23; // '{"type":"webauthn.get",' = 23 bytes
    }

    function _register() internal {
        vm.prank(account);
        v.register(credentialIdDigest, X, Y);
    }

    function _mockP256(bool valid) internal {
        bytes memory ret = valid ? abi.encodePacked(uint256(1)) : bytes("");
        // Disambiguate Vm.mockCall(address,bytes,bytes) overloads by qualifying the 3-arg call
        // via bytes4 selector so the compiler picks the correct one.
        (bool ok, ) = address(vm).call(
            abi.encodeWithSignature("mockCall(address,bytes,bytes)", P256, bytes(""), ret)
        );
        require(ok, "mockCall failed");
    }

    function test_register_and_read() public {
        _register();
        assertTrue(v.hasCredential(account, credentialIdDigest));
        (uint256 x, uint256 y) = v.getPubKey(account, credentialIdDigest);
        assertEq(x, X);
        assertEq(y, Y);
        assertEq(v.count(account), 1);
    }

    function test_register_rejects_zero_pubkey() public {
        vm.prank(account);
        vm.expectRevert(PasskeyValidator.InvalidPublicKey.selector);
        v.register(credentialIdDigest, 0, 1);
    }

    function test_register_rejects_duplicate() public {
        _register();
        vm.prank(account);
        vm.expectRevert(PasskeyValidator.AlreadyRegistered.selector);
        v.register(credentialIdDigest, X, Y);
    }

    function test_remove_requires_registration() public {
        vm.prank(account);
        vm.expectRevert(PasskeyValidator.NotRegistered.selector);
        v.remove(credentialIdDigest);
    }

    function test_remove_decrements_count() public {
        _register();
        vm.prank(account);
        v.remove(credentialIdDigest);
        assertFalse(v.hasCredential(account, credentialIdDigest));
        assertEq(v.count(account), 0);
    }

    function test_verify_returns_true_on_valid_precompile_response() public {
        _register();
        _mockP256(true);
        bytes32 hash = keccak256("hello");
        (string memory cdj, uint256 tIdx, uint256 cIdx) = _makeClientDataJSON(hash);
        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: hex"1234567890",
            clientDataJSON: cdj,
            challengeIndex: cIdx,
            typeIndex: tIdx,
            r: 0x1111111111111111111111111111111111111111111111111111111111111111,
            s: 0x2222222222222222222222222222222222222222222222222222222222222222,
            credentialIdDigest: credentialIdDigest
        });
        bytes memory sig = abi.encode(a);
        bytes4 mv = v.isValidSignature(account, hash, sig);
        assertEq(mv, bytes4(0x1626ba7e));
    }

    function test_verify_returns_invalid_on_precompile_failure() public {
        _register();
        _mockP256(false);
        bytes32 hash = keccak256("hello");
        (string memory cdj, uint256 tIdx, uint256 cIdx) = _makeClientDataJSON(hash);
        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: hex"ab",
            clientDataJSON: cdj,
            challengeIndex: cIdx,
            typeIndex: tIdx,
            r: 1, s: 2,
            credentialIdDigest: credentialIdDigest
        });
        bytes memory sig = abi.encode(a);
        bytes4 mv = v.isValidSignature(account, hash, sig);
        assertEq(mv, bytes4(0xffffffff));
    }

    function test_verify_fails_when_challenge_mismatches() public {
        _register();
        _mockP256(true);
        bytes32 hash = keccak256("hello");
        // Build clientData with a DIFFERENT hash so challenge != signed hash.
        (string memory cdj, uint256 tIdx, uint256 cIdx) = _makeClientDataJSON(keccak256("not-hello"));
        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: hex"ab",
            clientDataJSON: cdj,
            challengeIndex: cIdx,
            typeIndex: tIdx,
            r: 1, s: 2,
            credentialIdDigest: credentialIdDigest
        });
        bytes memory sig = abi.encode(a);
        bytes4 mv = v.isValidSignature(account, hash, sig);
        assertEq(mv, bytes4(0xffffffff));
    }

    function test_verify_fails_when_credential_not_registered() public {
        bytes32 hash = keccak256("hello");
        _mockP256(true);
        (string memory cdj, uint256 tIdx, uint256 cIdx) = _makeClientDataJSON(hash);
        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: hex"ab",
            clientDataJSON: cdj,
            challengeIndex: cIdx,
            typeIndex: tIdx,
            r: 1, s: 2,
            credentialIdDigest: keccak256("unknown")
        });
        bytes memory sig = abi.encode(a);
        bytes4 mv = v.isValidSignature(account, hash, sig);
        assertEq(mv, bytes4(0xffffffff));
    }

    // ─── helpers ───────────────────────────────────────────────────────

    bytes internal constant ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    /// @dev Encode a 32-byte value as 43 base64url chars (no padding).
    function _base64url32(bytes32 h) internal pure returns (string memory) {
        bytes memory raw = abi.encodePacked(h);
        // 32 bytes → 43 base64url chars (256 bits / 6 = 42.67, ceil = 43)
        bytes memory out = new bytes(43);
        uint256 acc;
        uint256 bits;
        uint256 outIdx;
        for (uint256 i; i < 32; i++) {
            acc = (acc << 8) | uint8(raw[i]);
            bits += 8;
            while (bits >= 6) {
                bits -= 6;
                out[outIdx++] = ALPHA[(acc >> bits) & 0x3f];
            }
        }
        if (bits > 0) {
            out[outIdx++] = ALPHA[(acc << (6 - bits)) & 0x3f];
        }
        return string(out);
    }
}
