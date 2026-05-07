// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/QuorumEnforcer.sol";
import "../src/ApprovedHashRegistry.sol";

/// Mock ERC-1271 wallet that returns the magic value when its stored
/// `expectedHash` matches the queried hash. Anything else returns 0xffffffff
/// so QuorumEnforcer's catch-all maps to ContractSigInvalid.
contract MockERC1271Wallet {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes32 public expectedHash;
    bool public revertOnCall;

    function setExpectedHash(bytes32 h) external { expectedHash = h; }
    function setRevert(bool r) external { revertOnCall = r; }

    function isValidSignature(bytes32 hash, bytes memory) external view returns (bytes4) {
        if (revertOnCall) revert("erc1271 revert");
        return hash == expectedHash ? MAGIC : bytes4(0xffffffff);
    }
}

contract QuorumEnforcerTest is Test {
    QuorumEnforcer internal enf;
    ApprovedHashRegistry internal approvedHashRegistry;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    uint256 internal carolPk = 0xCA401;
    address internal alice;
    address internal bob;
    address internal carol;
    address internal random = address(0xDEAD);

    bytes32 internal payloadHash = keccak256("ALLOC_DECIDED_TEST");

    function setUp() public {
        enf = new QuorumEnforcer();
        approvedHashRegistry = new ApprovedHashRegistry();
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
    }

    function _terms(uint8 threshold) internal view returns (bytes memory) {
        address[] memory set = new address[](3);
        set[0] = alice;
        set[1] = bob;
        set[2] = carol;
        return abi.encode(set, threshold, address(approvedHashRegistry));
    }

    /// Sorted-ascending packing: caller passes the signers in ascending order.
    /// Each entry is (r, s, v) packed as 65 bytes.
    function _packEcdsa(uint256[] memory pks, bytes32 hash) internal pure returns (address[] memory signers, bytes memory packed) {
        signers = new address[](pks.length);
        packed = new bytes(pks.length * 65);
        for (uint256 i; i < pks.length; i++) {
            signers[i] = vm.addr(pks[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], hash);
            uint256 off = i * 65;
            assembly {
                let dst := add(packed, add(0x20, off))
                mstore(dst, r)
                mstore(add(dst, 0x20), s)
                mstore8(add(dst, 0x40), v)
            }
        }
    }

    function test_two_of_three_ecdsa_passes() public view {
        // alice + bob — must be sorted ascending by address. Determine order.
        uint256[] memory pks = new uint256[](2);
        if (alice < bob) {
            pks[0] = alicePk;
            pks[1] = bobPk;
        } else {
            pks[0] = bobPk;
            pks[1] = alicePk;
        }
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_under_threshold_reverts() public {
        // Only one signer when threshold is 2.
        uint256[] memory pks = new uint256[](1);
        pks[0] = alicePk;
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.InsufficientQuorum.selector, 1, 2));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_unsorted_signers_revert_as_duplicate() public {
        // Pack alice then bob in the WRONG order (descending): if alice<bob, swap.
        uint256[] memory pks = new uint256[](2);
        if (alice < bob) {
            // Force descending — bob first.
            pks[0] = bobPk;
            pks[1] = alicePk;
        } else {
            pks[0] = alicePk;
            pks[1] = bobPk;
        }
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(); // DuplicateSigner — sort failure
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_duplicate_same_signer_reverts() public {
        // Same signer twice — sort comparison `signer <= prev` catches this.
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = alicePk;
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.DuplicateSigner.selector, alice));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_unauthorized_signer_reverts() public {
        // Sign with a key NOT in the steward set.
        uint256 randomPk = 0xBADBEEF;
        address randomAddr = vm.addr(randomPk);
        // Pick a signer that sorts before randomAddr OR adjust order
        uint256[] memory pks = new uint256[](2);
        if (alice < randomAddr) {
            pks[0] = alicePk;
            pks[1] = randomPk;
        } else {
            pks[0] = randomPk;
            pks[1] = alicePk;
        }
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.UnauthorizedSigner.selector, randomAddr));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_v1_pre_approved_hash_path() public {
        // Bob pre-approves the hash; alice signs ECDSA. Ordered ascending.
        vm.prank(bob);
        approvedHashRegistry.approveHash(payloadHash);

        bytes memory packed = new bytes(2 * 65);

        // Determine order
        bool aliceFirst = alice < bob;
        uint256[] memory pks = new uint256[](1);
        pks[0] = alicePk;

        // Build packed: ecdsa(alice) at slot for alice; v=1 entry for bob.
        // Need to interleave.
        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(alicePk, payloadHash);

        // For bob v=1: r = address(bob) left-padded; s = 0 (offset unused since
        // the registry stores the approval per-signer); v = 1.
        bytes32 br = bytes32(uint256(uint160(bob)));
        bytes32 bs = bytes32(0);
        uint8 bv = 1;

        uint256 slotA = aliceFirst ? 0 : 65;
        uint256 slotB = aliceFirst ? 65 : 0;
        assembly {
            let dst := add(packed, 0x20)
            let pa := add(dst, slotA)
            mstore(pa, ar)
            mstore(add(pa, 0x20), as_)
            mstore8(add(pa, 0x40), av)
            let pb := add(dst, slotB)
            mstore(pb, br)
            mstore(add(pb, 0x20), bs)
            mstore8(add(pb, 0x40), bv)
        }

        bytes memory args = abi.encode(payloadHash, packed);
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_v1_unapproved_hash_reverts() public {
        // Bob did NOT approve the hash. Build a v=1 entry; expect revert.
        bytes memory packed = new bytes(2 * 65);
        bool aliceFirst = alice < bob;
        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(alicePk, payloadHash);
        bytes32 br = bytes32(uint256(uint160(bob)));
        bytes32 bs = bytes32(0);
        uint8 bv = 1;

        uint256 slotA = aliceFirst ? 0 : 65;
        uint256 slotB = aliceFirst ? 65 : 0;
        assembly {
            let dst := add(packed, 0x20)
            let pa := add(dst, slotA)
            mstore(pa, ar)
            mstore(add(pa, 0x20), as_)
            mstore8(add(pa, 0x40), av)
            let pb := add(dst, slotB)
            mstore(pb, br)
            mstore(add(pb, 0x20), bs)
            mstore8(add(pb, 0x40), bv)
        }

        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.ApprovedHashRequired.selector, bob));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }
}
