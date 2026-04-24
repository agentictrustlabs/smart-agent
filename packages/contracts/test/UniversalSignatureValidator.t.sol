// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/UniversalSignatureValidator.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract UniversalSignatureValidatorTest is Test {
    using MessageHashUtils for bytes32;

    UniversalSignatureValidator internal sv;
    EntryPoint internal entryPoint;
    AgentAccountFactory internal factory;

    address internal owner;
    uint256 internal ownerKey;

    function setUp() public {
        sv = new UniversalSignatureValidator();
        entryPoint = new EntryPoint();
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        (owner, ownerKey) = makeAddrAndKey("owner");
    }

    function _sign(bytes32 hash, uint256 key) internal pure returns (bytes memory) {
        bytes32 ethSigned = hash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethSigned);
        return abi.encodePacked(r, s, v);
    }

    // ─── EOA path ──────────────────────────────────────────────────────

    function test_eoa_plain_signature() public view {
        bytes32 hash = keccak256("hi");
        bytes memory sig = _sign(hash, ownerKey);
        assertTrue(sv.isValidSigView(owner, hash, sig));
    }

    function test_eoa_wrong_signer_fails() public {
        (, uint256 otherKey) = makeAddrAndKey("other");
        bytes32 hash = keccak256("hi");
        bytes memory sig = _sign(hash, otherKey);
        assertFalse(sv.isValidSigView(owner, hash, sig));
    }

    // ─── ERC-1271 path — existing deployed account ─────────────────────

    function test_deployed_account_1271() public {
        AgentAccount acct = factory.createAccount(owner, 0);
        bytes32 hash = keccak256("for-1271");
        bytes memory sig = _sign(hash, ownerKey);
        assertTrue(sv.isValidSigView(address(acct), hash, sig));
    }

    // ─── ERC-6492 path — counterfactual deploy via isValidSig ──────────

    function test_6492_counterfactual_deploy_and_verify() public {
        address predicted = factory.getAddress(owner, 42);
        assertEq(predicted.code.length, 0);

        bytes memory innerSig = _sign(keccak256("counterfactual"), ownerKey);
        bytes memory factoryCalldata = abi.encodeCall(factory.createAccount, (owner, 42));
        bytes memory wrapped = abi.encodePacked(
            abi.encode(address(factory), factoryCalldata, innerSig),
            bytes32(0x6492649264926492649264926492649264926492649264926492649264926492)
        );
        bool ok = sv.isValidSig(predicted, keccak256("counterfactual"), wrapped);
        assertTrue(ok);
        // Deploy side-effect visible.
        assertGt(predicted.code.length, 0);
    }

    function test_6492_inner_sig_wrong_owner_returns_false() public {
        address predicted = factory.getAddress(owner, 99);
        (, uint256 otherKey) = makeAddrAndKey("other");
        bytes memory innerSig = _sign(keccak256("payload"), otherKey);
        bytes memory factoryCalldata = abi.encodeCall(factory.createAccount, (owner, 99));
        bytes memory wrapped = abi.encodePacked(
            abi.encode(address(factory), factoryCalldata, innerSig),
            bytes32(0x6492649264926492649264926492649264926492649264926492649264926492)
        );
        bool ok = sv.isValidSig(predicted, keccak256("payload"), wrapped);
        assertFalse(ok);
        // Account still got deployed, but signature didn't verify.
        assertGt(predicted.code.length, 0);
    }
}
