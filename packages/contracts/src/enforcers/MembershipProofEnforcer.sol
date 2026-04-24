// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";

/**
 * @title MembershipProofEnforcer
 * @notice Caveat that requires a valid AnonCreds presentation to redeem the
 *         delegation. Ties the Smart Agent delegation fabric to the SSI
 *         privacy plane: a delegation can depend on "caller holds a
 *         membership credential" without leaking which member, under what
 *         identity, or which other credentials.
 *
 * Design:
 *   Solidity cannot verify AnonCreds proofs on-chain (CL-signature
 *   verification is not EVM-friendly). The caveat instead commits to what
 *   the proof MUST satisfy (credDef commitment + predicate-shape commitment),
 *   and an off-chain verifier produces a signed attestation that this
 *   delegationHash was accompanied by a valid proof meeting the commitment.
 *   The enforcer checks the attestation signature against a configured
 *   off-chain-verifier address.
 *
 *   Caveat terms:
 *     abi.encode(address offChainVerifier, bytes32 credDefCommitment, bytes32 predicateCommitment)
 *
 *   Redemption args:
 *     abi.encode(bytes proofContextAttestation)
 *       where attestation = EIP-191 signature from offChainVerifier over
 *         keccak256(abi.encode(delegationHash, credDefCommitment, predicateCommitment))
 *
 *   Nothing about the proof itself touches the chain.
 */
contract MembershipProofEnforcer is ICaveatEnforcer {
    error InvalidTerms();
    error InvalidAttestation();
    error AttestationSignerMismatch();

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 delegationHash,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {
        if (terms.length != 32 * 3) revert InvalidTerms();
        (address offChainVerifier, bytes32 credDefCommitment, bytes32 predicateCommitment) =
            abi.decode(terms, (address, bytes32, bytes32));

        bytes memory attestation = abi.decode(args, (bytes));
        bytes32 digest = keccak256(abi.encode(
            delegationHash,
            credDefCommitment,
            predicateCommitment
        ));
        bytes32 ethDigest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        address signer = _recover(ethDigest, attestation);
        if (signer == address(0)) revert InvalidAttestation();
        if (signer != offChainVerifier) revert AttestationSignerMismatch();
    }

    function afterHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {
        // No post-execution check
    }

    function _recover(bytes32 digest, bytes memory sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
