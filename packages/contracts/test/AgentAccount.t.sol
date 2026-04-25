// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/libraries/WebAuthnLib.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract AgentAccountTest is Test {
    EntryPoint public entryPoint;
    AgentAccountFactory public factory;
    AgentAccount public account;

    address public owner;
    uint256 public ownerKey;
    address public other;
    uint256 public otherKey;

    function setUp() public {
        // Create test signers
        (owner, ownerKey) = makeAddrAndKey("owner");
        (other, otherKey) = makeAddrAndKey("other");

        // Deploy EntryPoint
        entryPoint = new EntryPoint();

        // Deploy factory
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));

        // Deploy agent account via factory
        account = factory.createAccount(owner, 0);

        // Fund the account
        vm.deal(address(account), 10 ether);
    }

    // ─── Deployment ─────────────────────────────────────────────────

    function test_factory_deploys_account() public view {
        assertGt(address(account).code.length, 0, "Account should be deployed");
    }

    function test_factory_deterministic_address() public view {
        address predicted = factory.getAddress(owner, 0);
        assertEq(address(account), predicted, "Address should match prediction");
    }

    function test_factory_returns_existing_on_redeploy() public {
        AgentAccount account2 = factory.createAccount(owner, 0);
        assertEq(address(account), address(account2), "Should return same account");
    }

    function test_factory_different_salt_different_address() public {
        AgentAccount account2 = factory.createAccount(owner, 1);
        assertTrue(address(account) != address(account2), "Different salt = different address");
    }

    // ─── Owner Management ───────────────────────────────────────────

    function test_initial_owner_is_set() public view {
        assertTrue(account.isOwner(owner), "Initial owner should be set");
        // Factory adds msg.sender (test contract) as server signer co-owner
        assertTrue(account.isOwner(address(this)), "Server signer should be co-owner");
        assertEq(account.ownerCount(), 2, "Should have 2 owners (user + server signer)");
    }

    function test_non_owner_is_not_owner() public view {
        assertFalse(account.isOwner(other), "Non-owner should not be owner");
    }

    function test_add_owner_via_self_call() public {
        // Simulate a self-call (as if via UserOp execution)
        vm.prank(address(account));
        account.addOwner(other);

        assertTrue(account.isOwner(other), "New owner should be added");
        assertEq(account.ownerCount(), 3, "Should have 3 owners (user + server + new)");
    }

    function test_add_owner_reverts_if_not_self() public {
        vm.prank(owner);
        vm.expectRevert(AgentAccount.NotFromSelf.selector);
        account.addOwner(other);
    }

    function test_add_owner_reverts_if_already_owner() public {
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.OwnerAlreadyExists.selector, owner));
        account.addOwner(owner);
    }

    function test_add_owner_reverts_if_zero_address() public {
        vm.prank(address(account));
        vm.expectRevert(AgentAccount.ZeroAddress.selector);
        account.addOwner(address(0));
    }

    function test_remove_owner_via_self_call() public {
        // Account has 2 owners (user + server signer)
        // Remove original owner
        vm.prank(address(account));
        account.removeOwner(owner);

        assertFalse(account.isOwner(owner), "Removed owner should not be owner");
        assertEq(account.ownerCount(), 1, "Should have 1 owner (server signer remains)");
    }

    function test_remove_last_owner_reverts() public {
        // Remove first owner, leaving only server signer
        vm.prank(address(account));
        account.removeOwner(owner);
        // Now try to remove last owner
        vm.prank(address(account));
        vm.expectRevert(AgentAccount.CannotRemoveLastOwner.selector);
        account.removeOwner(address(this));
    }

    function test_remove_non_owner_reverts() public {
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.OwnerDoesNotExist.selector, other));
        account.removeOwner(other);
    }

    // ─── ERC-1271 ───────────────────────────────────────────────────

    function test_erc1271_valid_signature() public view {
        bytes32 hash = keccak256("test message");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        bytes4 result = account.isValidSignature(hash, signature);
        assertEq(result, bytes4(0x1626ba7e), "Valid owner signature should return magic value");
    }

    function test_erc1271_invalid_signature() public view {
        bytes32 hash = keccak256("test message");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        bytes4 result = account.isValidSignature(hash, signature);
        assertEq(result, bytes4(0xffffffff), "Invalid signature should return failure");
    }

    function test_erc1271_strips_6492_envelope() public view {
        bytes32 hash = keccak256("6492-wrapped");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ethSignedHash);
        bytes memory innerSig = abi.encodePacked(r, s, v);

        // factory + calldata are irrelevant here — our account is already deployed;
        // we're just asserting the envelope gets unwrapped before ECDSA recovery.
        bytes memory wrapped = abi.encodePacked(
            abi.encode(address(factory), abi.encodeCall(factory.createAccount, (owner, 0)), innerSig),
            bytes32(0x6492649264926492649264926492649264926492649264926492649264926492)
        );

        bytes4 result = account.isValidSignature(hash, wrapped);
        assertEq(result, bytes4(0x1626ba7e), "6492-wrapped owner sig should still verify");
    }

    // ─── Signature type-byte routing (0x00 ECDSA prefix) ────────────

    function test_sig_type_byte_ecdsa() public view {
        bytes32 hash = keccak256("type-prefixed");
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ethSignedHash);
        bytes memory inner = abi.encodePacked(r, s, v);
        bytes memory prefixed = abi.encodePacked(uint8(0x00), inner);

        bytes4 result = account.isValidSignature(hash, prefixed);
        assertEq(result, bytes4(0x1626ba7e));
    }

    // ─── Passkey management ─────────────────────────────────────────

    bytes32 internal constant CRED_1 = keccak256("cred-device-1");
    bytes32 internal constant CRED_2 = keccak256("cred-device-2");

    function test_addPasskey_via_self_call() public {
        vm.prank(address(account));
        account.addPasskey(CRED_1, 0x1111, 0x2222);
        assertTrue(account.hasPasskey(CRED_1));
        (uint256 x, uint256 y) = account.getPasskey(CRED_1);
        assertEq(x, 0x1111);
        assertEq(y, 0x2222);
        assertEq(account.passkeyCount(), 1);
    }

    function test_addPasskey_reverts_not_self() public {
        vm.prank(owner);
        vm.expectRevert(AgentAccount.NotFromSelf.selector);
        account.addPasskey(CRED_1, 0x1111, 0x2222);
    }

    function test_addPasskey_reverts_zero_pubkey() public {
        vm.prank(address(account));
        vm.expectRevert(AgentAccount.InvalidPasskeyPublicKey.selector);
        account.addPasskey(CRED_1, 0, 1);
    }

    function test_addPasskey_reverts_duplicate() public {
        vm.prank(address(account));
        account.addPasskey(CRED_1, 0x1111, 0x2222);
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(AgentAccount.PasskeyAlreadyRegistered.selector, CRED_1));
        account.addPasskey(CRED_1, 0x1111, 0x2222);
    }

    function test_removePasskey_happy_path() public {
        vm.prank(address(account));
        account.addPasskey(CRED_1, 0x1111, 0x2222);
        vm.prank(address(account));
        account.removePasskey(CRED_1);
        assertFalse(account.hasPasskey(CRED_1));
        assertEq(account.passkeyCount(), 0);
    }

    function test_removePasskey_cannot_remove_last_signer() public {
        // The factory seeds the account with TWO owners: `owner` + serverSigner
        // (the test contract itself). To isolate the last-signer invariant:
        // register a passkey, then remove both owners (allowed since the passkey
        // covers the "at least one signer" invariant), then try to remove the
        // passkey — which must revert.
        vm.prank(address(account));
        account.addPasskey(CRED_1, 0x1111, 0x2222);
        vm.prank(address(account));
        account.removeOwner(address(this));      // 2 owners → 1
        vm.prank(address(account));
        account.removeOwner(owner);              // 1 owner + 1 passkey → 0 owners
        // Now the sole signer is the passkey. Removing it must revert.
        vm.prank(address(account));
        vm.expectRevert(AgentAccount.CannotRemoveLastSigner.selector);
        account.removePasskey(CRED_1);
    }

    function test_removeOwner_allows_drop_to_passkey_only() public {
        vm.prank(address(account));
        account.addPasskey(CRED_1, 0x1111, 0x2222);
        vm.prank(address(account));
        account.removeOwner(address(this));
        vm.prank(address(account));
        account.removeOwner(owner);
        assertEq(account.ownerCount(), 0);
        assertEq(account.passkeyCount(), 1);
    }

    function test_removeOwner_blocked_without_other_signers() public {
        // Drop the second owner first so `owner` is the only one.
        vm.prank(address(account));
        account.removeOwner(address(this));
        vm.prank(address(account));
        vm.expectRevert(AgentAccount.CannotRemoveLastOwner.selector);
        account.removeOwner(owner);
    }

    // ─── WebAuthn validation path through AgentAccount ────────────────

    function test_isValidSignature_routes_webauthn() public {
        // Register a passkey.
        vm.prank(address(account));
        account.addPasskey(CRED_1, 0x55, 0x66);
        // Mock the RIP-7212 precompile to return success.
        (bool mockOk,) = address(vm).call(
            abi.encodeWithSignature(
                "mockCall(address,bytes,bytes)",
                address(0x100),
                bytes(""),
                abi.encodePacked(uint256(1))
            )
        );
        require(mockOk);

        bytes32 hash = keccak256("hello-passkey");
        // Build a minimal valid clientDataJSON with the correct challenge encoding.
        string memory cdj = _buildClientDataJSON(hash);
        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: hex"abcdef",
            clientDataJSON: cdj,
            challengeIndex: 23,
            typeIndex: 1,
            r: 1, s: 2,
            credentialIdDigest: CRED_1
        });
        bytes memory typed = abi.encodePacked(uint8(0x01), abi.encode(a));
        bytes4 result = account.isValidSignature(hash, typed);
        assertEq(result, bytes4(0x1626ba7e));
    }

    function test_isValidSignature_webauthn_rejects_unknown_credential() public {
        bytes32 hash = keccak256("hello-passkey");
        string memory cdj = _buildClientDataJSON(hash);
        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: hex"abcdef",
            clientDataJSON: cdj,
            challengeIndex: 23,
            typeIndex: 1,
            r: 1, s: 2,
            credentialIdDigest: CRED_2  // not registered
        });
        bytes memory typed = abi.encodePacked(uint8(0x01), abi.encode(a));
        bytes4 result = account.isValidSignature(hash, typed);
        assertEq(result, bytes4(0xffffffff));
    }

    // helpers
    bytes internal constant ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    function _base64url32(bytes32 h) internal pure returns (string memory) {
        bytes memory raw = abi.encodePacked(h);
        bytes memory out = new bytes(43);
        uint256 acc;
        uint256 bits;
        uint256 outIdx;
        for (uint256 i; i < 32; i++) {
            acc = (acc << 8) | uint8(raw[i]);
            bits += 8;
            while (bits >= 6) { bits -= 6; out[outIdx++] = ALPHA[(acc >> bits) & 0x3f]; }
        }
        if (bits > 0) out[outIdx++] = ALPHA[(acc << (6 - bits)) & 0x3f];
        return string(out);
    }

    function _buildClientDataJSON(bytes32 hash) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '{"type":"webauthn.get","challenge":"', _base64url32(hash), '","origin":"https://smart-agent.test","crossOrigin":false}'
        ));
    }

    // ─── Execution ──────────────────────────────────────────────────

    function test_execute_from_entrypoint() public {
        address target = makeAddr("target");
        vm.deal(address(account), 1 ether);

        vm.prank(address(entryPoint));
        account.execute(target, 0.5 ether, "");

        assertEq(target.balance, 0.5 ether, "Target should receive ETH");
    }

    function test_execute_reverts_from_unauthorized() public {
        vm.prank(other);
        vm.expectRevert();
        account.execute(other, 0, "");
    }

    // ─── Receive ETH ────────────────────────────────────────────────

    function test_receive_eth() public {
        uint256 balanceBefore = address(account).balance;
        vm.deal(address(this), 1 ether);
        (bool success,) = payable(address(account)).call{value: 1 ether}("");
        assertTrue(success, "Should accept ETH");
        assertEq(address(account).balance, balanceBefore + 1 ether, "Balance should increase");
    }

    // ─── EntryPoint ─────────────────────────────────────────────────

    function test_entrypoint_is_correct() public view {
        assertEq(address(account.entryPoint()), address(entryPoint), "EntryPoint should match");
    }

    function test_get_nonce() public view {
        uint256 nonce = account.getNonce();
        assertEq(nonce, 0, "Initial nonce should be 0");
    }
}
