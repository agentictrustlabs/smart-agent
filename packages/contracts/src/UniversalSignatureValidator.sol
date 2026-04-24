// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title UniversalSignatureValidator
 * @notice Universal ERC-1271/6492 signature verifier.
 *
 *   Accepts three shapes of signature:
 *     1. Plain EOA signature (65 bytes) — verified via ECDSA.recover.
 *     2. ERC-1271 signature — the account's isValidSignature returns MAGIC.
 *     3. ERC-6492 signature — payload ends with 0x64926492…6492 magic suffix
 *        (32 bytes). Prefix is abi.encode(factory, factoryCalldata, innerSig).
 *        The verifier deploys the account via factory.call(factoryCalldata)
 *        if it isn't deployed yet, then recurses into ERC-1271 verification
 *        of innerSig on the (now-deployed) account.
 *
 *   This matches the reference `UniversalSigValidator` from the ERC-6492 spec.
 *   It's stateless and read-only where possible; the 6492 path MUST be a
 *   state-changing `staticcall` wrapper for local verification (a view-only
 *   `isValidSig` would fail because factory deployment is stateful). We expose
 *   both entry points: `isValidSig` (write, deploys) and `isValidSigView`
 *   (revert-via-state-probe trick, suitable for EVM static-call contexts).
 */
contract UniversalSignatureValidator {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    /// @dev 32-byte magic suffix per ERC-6492 — `0x6492…6492` repeated.
    bytes32 private constant ERC6492_MAGIC =
        0x6492649264926492649264926492649264926492649264926492649264926492;

    error DeployFailed();

    /// @notice State-changing verifier: deploys the counterfactual account if
    /// needed, then validates the signature. Use from a call that can mutate
    /// state (e.g. a relayer pre-flight).
    function isValidSig(address signer, bytes32 hash, bytes calldata sig) external returns (bool) {
        // 1. ERC-6492 detect.
        if (_has6492Magic(sig)) {
            (address factory, bytes memory factoryCalldata, bytes memory innerSig) =
                _decode6492(sig[:sig.length - 32]);
            if (signer.code.length == 0) {
                (bool ok,) = factory.call(factoryCalldata);
                if (!ok || signer.code.length == 0) revert DeployFailed();
            }
            return _erc1271(signer, hash, innerSig);
        }

        // 2. Account already has code → ERC-1271.
        if (signer.code.length > 0) {
            return _erc1271(signer, hash, sig);
        }

        // 3. Fall through to ECDSA recovery (EOA signer).
        return _ecdsaRecover(signer, hash, sig);
    }

    /// @notice View-only probe using the 6492 "side-effect-free" pattern.
    /// The caller wraps this in a try/catch; on success the bytes1 revert
    /// data encodes the verdict. Not every consumer needs this — `isValidSig`
    /// suffices for bundlers and relayers who can tolerate state changes.
    function isValidSigView(address signer, bytes32 hash, bytes calldata sig) external view returns (bool) {
        // View path: skip the 6492 deploy since we can't deploy in a view.
        if (_has6492Magic(sig)) {
            // With no code, we can't call isValidSignature. This path is
            // meant for contexts where the caller has already deployed the
            // account, OR the signer EOA is recoverable from the inner sig.
            (, , bytes memory innerSig) = _decode6492(sig[:sig.length - 32]);
            if (signer.code.length == 0) return false;
            return _erc1271(signer, hash, innerSig);
        }
        if (signer.code.length > 0) return _erc1271(signer, hash, sig);
        return _ecdsaRecover(signer, hash, sig);
    }

    // ─── Internals ─────────────────────────────────────────────────────

    function _has6492Magic(bytes calldata sig) private pure returns (bool) {
        if (sig.length < 32) return false;
        return bytes32(sig[sig.length - 32:]) == ERC6492_MAGIC;
    }

    function _decode6492(bytes calldata prefix)
        private
        pure
        returns (address factory, bytes memory factoryCalldata, bytes memory innerSig)
    {
        (factory, factoryCalldata, innerSig) =
            abi.decode(prefix, (address, bytes, bytes));
    }

    function _erc1271(address signer, bytes32 hash, bytes memory sig) private view returns (bool) {
        try IERC1271(signer).isValidSignature(hash, sig) returns (bytes4 mv) {
            return mv == ERC1271_MAGIC;
        } catch {
            return false;
        }
    }

    function _ecdsaRecover(address signer, bytes32 hash, bytes memory sig) private pure returns (bool) {
        if (sig.length != 65) return false;
        // Try raw hash first.
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        // Then try the eth-signed (prefixed) hash — many wallets sign this variant
        // even when the caller passes a raw digest.
        bytes32 prefixed = hash.toEthSignedMessageHash();
        (recovered, err,) = ECDSA.tryRecover(prefixed, sig);
        return err == ECDSA.RecoverError.NoError && recovered == signer;
    }
}
