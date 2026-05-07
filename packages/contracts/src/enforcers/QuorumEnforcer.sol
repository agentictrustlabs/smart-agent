// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";
import "../ApprovedHashRegistry.sol";
import {IERC1271} from "openzeppelin-contracts/contracts/interfaces/IERC1271.sol";

/**
 * @title QuorumEnforcer
 * @notice N-of-M EIP-712 signature aggregation over a payload hash. Sig
 *         layout adopts Safe's `checkSignatures` packing verbatim so
 *         (a) Safe SDK tooling can sign for our pools, and (b) we get
 *         the battle-tested anti-duplicate scheme for free.
 *
 * @dev terms = abi.encode(
 *        address[] signerSet,        // the steward set bound at delegation-mint time
 *        uint8 threshold,            // minimum valid sigs required
 *        address approvedHashRegistry // companion contract for v=1 path
 *      )
 *
 *      args = abi.encode(
 *        bytes32 payloadHash,        // the message the stewards signed (EIP-712 typed-data hash)
 *        bytes signatures            // packed sig blob, sorted-ascending by signer
 *      )
 *
 *      Sig blob layout per entry (65 bytes constant slot in the sorted region):
 *        {32 r/data}{32 s/data}{1 v/type}
 *
 *      v-byte type discrimination:
 *         v == 27 || v == 28  → ECDSA over `payloadHash`
 *         v >  30             → eth_sign ECDSA: signer pre-prefixed payloadHash with
 *                               "\x19Ethereum Signed Message:\n32"; v passed in {31,32}
 *         v == 1              → pre-approved hash; r = signer addr (left-padded);
 *                               signer must have called approvedHashRegistry.approveHash(payloadHash)
 *         v == 0              → ERC-1271 contract sig; r = signer addr (left-padded),
 *                               s = byte offset into `signatures` calldata where the
 *                                   length-prefixed dynamic sig blob starts
 *
 *      v == 2 (RIP-7212 secp256r1 / passkey) is reserved but not yet implemented
 *      in this enforcer — passkey stewards can use the v=1 approveHash escape
 *      hatch in the meantime.
 *
 *      Sorted-ascending signer ordering is the anti-duplicate scheme — any two
 *      adjacent signers must satisfy `prev < curr`. This eliminates the need
 *      for a separate "seen" mapping and ensures a malicious caller can't
 *      submit the same signer's sig twice to inflate the count.
 *
 *      The signer derived from each sig must be present in `signerSet`. The
 *      enforcer does NOT do its own eligibility check — that's the dedicated
 *      job of `StewardEligibilityEnforcer`, which lives alongside this enforcer
 *      in the SESSION_DELEGATION caveat stack and consults the registry at
 *      sig-verification time.
 *
 *      The first `threshold` packed entries are checked. Excess entries beyond
 *      threshold are ignored — callers should not pad blobs unnecessarily as
 *      the calldata cost scales linearly.
 */
contract QuorumEnforcer is ICaveatEnforcer {
    error InsufficientQuorum(uint256 supplied, uint8 threshold);
    error UnauthorizedSigner(address signer);
    error DuplicateSigner(address signer);
    error InvalidSignature(uint8 v);
    error ApprovedHashRequired(address signer);
    error ContractSigInvalid(address signer);

    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32, // delegationHash
        address, // delegator
        address, // redeemer
        address, // target
        uint256, // value
        bytes calldata // callData
    ) external view override {
        (address[] memory signerSet, uint8 threshold, address approvedHashRegistry) =
            abi.decode(terms, (address[], uint8, address));
        (bytes32 payloadHash, bytes memory signatures) = abi.decode(args, (bytes32, bytes));

        if (signatures.length < uint256(threshold) * 65) {
            revert InsufficientQuorum(signatures.length / 65, threshold);
        }

        address prev;
        for (uint256 i; i < threshold; i++) {
            address signer = _recover(payloadHash, signatures, i, approvedHashRegistry);

            // Sorted-ascending check (also rejects duplicates).
            if (signer <= prev) revert DuplicateSigner(signer);
            prev = signer;

            // Membership in the original signer set bound at delegation time.
            if (!_inSet(signer, signerSet)) revert UnauthorizedSigner(signer);
        }
    }

    function afterHook(
        bytes calldata, bytes calldata, bytes32,
        address, address, address, uint256, bytes calldata
    ) external pure override {}

    /// Recover the signer for the i-th 65-byte slot.
    function _recover(
        bytes32 payloadHash,
        bytes memory signatures,
        uint256 index,
        address approvedHashRegistry
    ) internal view returns (address signer) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint256 offset = index * 65;
        assembly {
            let pos := add(signatures, add(0x20, offset))
            r := mload(pos)
            s := mload(add(pos, 0x20))
            v := byte(0, mload(add(pos, 0x40)))
        }

        if (v == 0) {
            // ERC-1271 contract signature. r holds the signer (left-padded);
            // s holds the offset into `signatures` to the (length, blob) tail.
            signer = address(uint160(uint256(r)));
            uint256 sigOffset = uint256(s);
            // Slice the dynamic sig blob out of `signatures`.
            uint256 sigLen;
            assembly {
                sigLen := mload(add(signatures, add(0x20, sigOffset)))
            }
            bytes memory dyn = new bytes(sigLen);
            assembly {
                let src := add(signatures, add(0x40, sigOffset))
                let dst := add(dyn, 0x20)
                for { let j := 0 } lt(j, sigLen) { j := add(j, 0x20) } {
                    mstore(add(dst, j), mload(add(src, j)))
                }
            }
            try IERC1271(signer).isValidSignature(payloadHash, dyn) returns (bytes4 magic) {
                if (magic != ERC1271_MAGIC) revert ContractSigInvalid(signer);
            } catch {
                revert ContractSigInvalid(signer);
            }
        } else if (v == 1) {
            // Pre-approved hash. r is signer, payloadHash must be in registry.
            signer = address(uint160(uint256(r)));
            if (!ApprovedHashRegistry(approvedHashRegistry).isApproved(signer, payloadHash)) {
                revert ApprovedHashRequired(signer);
            }
        } else if (v == 27 || v == 28) {
            signer = ecrecover(payloadHash, v, r, s);
            if (signer == address(0)) revert InvalidSignature(v);
        } else if (v > 30) {
            // eth_sign: signer prefixed payloadHash with the "Ethereum Signed Message"
            // wrapper before signing. Subtract 4 from v to get the real recovery byte.
            bytes32 wrapped = keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
            );
            signer = ecrecover(wrapped, v - 4, r, s);
            if (signer == address(0)) revert InvalidSignature(v);
        } else {
            revert InvalidSignature(v);
        }
    }

    function _inSet(address signer, address[] memory set) internal pure returns (bool) {
        for (uint256 i; i < set.length; i++) {
            if (set[i] == signer) return true;
        }
        return false;
    }
}
