// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// KMS K4 PR-2 — on-chain proof that AWS KMS asymmetric secp256k1
// signatures are accepted by AgentAccount via ERC-1271.
//
// The fixture in `test/fixtures/kms-signature.json` is produced by
// `test/fixtures/generate-kms-fixture.ts` using the same secp256k1 +
// EIP-2 low-s + (r||s||v=recovery+27) pipeline that the production AWS
// KMS signer (`packages/sdk/src/key-custody/aws-kms-signer.ts`) uses.
// KMS itself cannot run inside Foundry CI; the local-secp256k1 signer
// produces byte-identical output for the same private key, so the
// fixture is semantically a real KMS-produced signature.
//
// Reproduce the fixture:
//   pnpm --filter @smart-agent/sdk exec tsx \
//     /home/barb/smart-agent/packages/contracts/test/fixtures/generate-kms-fixture.ts
//
// Test surface:
//   • Happy path: an AgentAccount that owns the fixture address accepts the
//     signature via isValidSignature → returns 0x1626ba7e (ERC-1271 magic).
//   • Negative path: an AgentAccount whose only owner is a DIFFERENT
//     address rejects the same signature → returns 0xffffffff.

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";
import "./helpers/MockGovernance.sol";

contract KmsSigningTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;

    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant ERC1271_FAIL = 0xffffffff;

    // Loaded from the fixture in setUp.
    address internal kmsSignerAddress;
    address internal wrongAddress;
    bytes32 internal messageHash;
    bytes internal signature;

    function setUp() public {
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this), address(this), address(new MockGovernance(address(this))));

        // Read + parse the fixture. `vm.readFile` is scoped to `./test/fixtures`
        // via `fs_permissions` in foundry.toml.
        string memory raw = vm.readFile("./test/fixtures/kms-signature.json");
        kmsSignerAddress = vm.parseJsonAddress(raw, ".address");
        wrongAddress = vm.parseJsonAddress(raw, ".wrongAddress");
        messageHash = vm.parseJsonBytes32(raw, ".messageHash");
        signature = vm.parseJsonBytes(raw, ".signature");

        // Sanity: the fixture's signature MUST be 65 bytes with v ∈ {27, 28}.
        assertEq(signature.length, 65, "fixture signature must be 65 bytes");
        uint8 v = uint8(signature[64]);
        assertTrue(v == 27 || v == 28, "fixture v must be 27 or 28");
    }

    // ─── Happy path ─────────────────────────────────────────────────

    function test_isValidSignature_accepts_kms_signature_for_owner() public {
        // Deploy an account whose initial owner is the fixture's signer.
        // The factory adds `msg.sender` as a server-signer co-owner, but
        // the fixture's owner is the FIRST owner — both can sign.
        AgentAccount account = factory.createAccount(kmsSignerAddress, 42);

        bytes4 result = account.isValidSignature(messageHash, signature);
        assertEq(
            result,
            ERC1271_MAGIC,
            "KMS-produced signature must verify via ERC-1271 when owner matches"
        );
    }

    function test_isValidSignature_accepts_after_addOwner() public {
        // Build an account owned by an unrelated key, then onChain addOwner
        // the KMS signer (simulating the rotation procedure step 4 of K4 §9).
        (address other, ) = makeAddrAndKey("other-owner");
        AgentAccount account = factory.createAccount(other, 43);

        // Self-call to add the KMS signer as a co-owner.
        vm.prank(address(account));
        account.addOwner(kmsSignerAddress);
        assertTrue(account.isOwner(kmsSignerAddress), "addOwner should make the KMS signer an owner");

        bytes4 result = account.isValidSignature(messageHash, signature);
        assertEq(result, ERC1271_MAGIC, "post-addOwner signature must verify");
    }

    // ─── Negative path ──────────────────────────────────────────────

    function test_isValidSignature_rejects_when_signer_not_owner() public {
        // Account is owned by the WRONG address (different secp256k1 key).
        // The signature was produced by `kmsSignerAddress`; recovery yields
        // that address; account.isOwner() returns false → magic value NOT
        // returned.
        // Spec 007 Phase A — the factory no longer auto-coowns the
        // test contract, so we don't have to call removeOwner.
        AgentAccount account = factory.createAccount(wrongAddress, 44);
        assertFalse(account.isOwner(kmsSignerAddress), "fixture address must not be an owner");
        assertFalse(account.isOwner(address(this)), "test contract must not be an owner (Phase A)");

        bytes4 result = account.isValidSignature(messageHash, signature);
        assertTrue(result != ERC1271_MAGIC, "signature from non-owner must not return magic value");
        assertEq(result, ERC1271_FAIL, "isValidSignature should return ERC1271_FAIL for non-owner");
    }

    function test_isValidSignature_rejects_wrong_message_hash() public {
        // Owner is correct, but the message hash is different — recovery
        // yields a different (or invalid) address.
        AgentAccount account = factory.createAccount(kmsSignerAddress, 45);
        bytes32 wrongHash = keccak256("different message");
        bytes4 result = account.isValidSignature(wrongHash, signature);
        assertTrue(result != ERC1271_MAGIC, "different message hash must not verify");
    }

    // ─── Low-s invariant on the fixture ────────────────────────────

    function test_fixture_is_low_s() public view {
        // Extract s from the 65-byte signature (bytes 32..63).
        bytes memory sigBytes = signature;
        bytes32 s;
        assembly {
            s := mload(add(sigBytes, 0x40)) // 32 (length prefix) + 32 (r) = 0x40
        }
        // secp256k1 n/2 — signatures with s above this are non-canonical.
        bytes32 sCeil = bytes32(uint256(0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0));
        assertTrue(uint256(s) <= uint256(sCeil), "fixture s must satisfy EIP-2 low-s");
    }
}
