// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/core/BaseAccount.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "./IAgentAccount.sol";
import "./libraries/WebAuthnLib.sol";

/**
 * @title AgentAccount
 * @notice ERC-4337 + UUPS-upgradeable smart account — agent identity anchor.
 *
 * The agent address IS the identity (did:ethr:<chainId>:<address>).
 * UUPS upgradeability means the implementation can evolve without
 * changing the proxy address or losing state.
 *
 * Upgrade authorization: only the account itself (via UserOp or self-call).
 * This follows the MetaMask DeleGator pattern for upgradeable smart accounts.
 *
 * Supports:
 * - Multi-owner with ERC-1271 signature validation
 * - ERC-4337 UserOp validation
 * - ERC-7710 delegated execution via DelegationManager
 * - UUPS upgrades (ERC-1822)
 */
contract AgentAccount is BaseAccount, Initializable, UUPSUpgradeable, IAgentAccount, IERC1271 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @dev ERC-1271 magic value for valid signature
    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    /// @dev The ERC-4337 EntryPoint contract
    IEntryPoint private immutable _entryPoint;

    /// @dev Authorized DelegationManager (ERC-7710 executor)
    address private _delegationManager;

    /// @dev Owner set
    mapping(address => bool) private _owners;
    uint256 private _ownerCount;

    // ─── Errors ─────────────────────────────────────────────────────

    error NotFromSelf();
    error NotOwnerOrSelf();
    error OwnerAlreadyExists(address owner);
    error OwnerDoesNotExist(address owner);
    error CannotRemoveLastOwner();
    error ZeroAddress();
    error PasskeyAlreadyRegistered(bytes32 credentialIdDigest);
    error PasskeyNotRegistered(bytes32 credentialIdDigest);
    error InvalidPasskeyPublicKey();
    error CannotRemoveLastSigner();
    error UnknownSignatureType(uint8 sigType);

    // ─── Modifiers ──────────────────────────────────────────────────

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotFromSelf();
        _;
    }

    // ─── Constructor / Initializer ──────────────────────────────────

    constructor(IEntryPoint entryPoint_) {
        _entryPoint = entryPoint_;
        _disableInitializers();
    }

    /**
     * @notice Initialize the account with an initial owner, optional server signer, and DelegationManager.
     * @param initialOwner The primary owner of this agent account (user's EOA).
     * @param serverSigner The server/deployer address added as co-owner for delegation signing.
     *                     Use address(0) to skip (single-owner mode).
     * @param dm The DelegationManager address (ERC-7710 executor). Use address(0) to skip.
     */
    function initialize(address initialOwner, address serverSigner, address dm) external initializer {
        if (initialOwner == address(0)) revert ZeroAddress();
        _owners[initialOwner] = true;
        _ownerCount = 1;
        emit OwnerAdded(initialOwner);

        // Add server signer as co-owner (for delegation signing in server-relay mode)
        if (serverSigner != address(0) && serverSigner != initialOwner) {
            _owners[serverSigner] = true;
            _ownerCount = 2;
            emit OwnerAdded(serverSigner);
        }

        _delegationManager = dm;
    }

    // ─── UUPS Upgrade ──────────────────────────────────────────────

    /**
     * @dev Only the account itself can authorize upgrades (via UserOp or self-call).
     *      This prevents unauthorized implementation changes.
     */
    function _authorizeUpgrade(address) internal view override onlySelf {}

    /// @notice Returns the current implementation version.
    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    // ─── Delegation Manager (ERC-7710) ─────────────────────────────

    /**
     * @notice Set the DelegationManager authorized to execute on behalf of this account.
     *         Following ERC-7710 pattern: DelegationManager calls execute() after
     *         validating the delegation chain and caveats.
     *         Can be called by an owner (for initial setup) or by the account itself.
     */
    function setDelegationManager(address dm) external {
        if (msg.sender != address(this) && !_owners[msg.sender]) {
            revert NotOwnerOrSelf();
        }
        _delegationManager = dm;
    }

    /// @notice Get the currently authorized DelegationManager.
    function delegationManager() external view returns (address) {
        return _delegationManager;
    }

    // ─── ERC-7579 introspection (compatibility-only) ──────────────────

    /**
     * @notice Stable account-implementation identifier.
     * @dev We do NOT implement the full ERC-7579 install/uninstall module API
     *      — AgentAccount uses a delegation-manager model with caveat-enforcer
     *      modules rather than per-account module slots. This accessor exists
     *      so 7579-aware wallets can identify the implementation without
     *      false-positively assuming install/uninstall support.
     */
    function accountId() external pure returns (string memory) {
        return "smart-agent.agent-account.1";
    }

    // ─── ERC-4337 ───────────────────────────────────────────────────

    /// @inheritdoc BaseAccount
    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @inheritdoc BaseAccount
    /// @dev Routes on the leading signature-type byte:
    ///        0x00 or bare 65-byte sig → ECDSA (backward-compatible default)
    ///        0x01                      → WebAuthn (abi.encoded Assertion follows)
    ///      Unknown types return SIG_VALIDATION_FAILED rather than reverting
    ///      so the ERC-4337 validation phase stays bundler-friendly.
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256 validationData) {
        return _validateSig(userOpHash, userOp.signature) ? 0 : 1;
    }

    /// @dev Allow execution from EntryPoint, account itself (via UserOp), or DelegationManager (ERC-7710)
    function _requireForExecute() internal view override {
        if (
            msg.sender != address(entryPoint()) &&
            msg.sender != address(this) &&
            msg.sender != _delegationManager
        ) {
            revert NotFromEntryPoint(msg.sender, address(this), address(entryPoint()));
        }
    }

    // ─── ERC-1271 ───────────────────────────────────────────────────

    /// @dev 32-byte ERC-6492 magic suffix — `0x6492…6492` repeated.
    bytes32 private constant ERC6492_MAGIC =
        0x6492649264926492649264926492649264926492649264926492649264926492;

    /// @inheritdoc IERC1271
    /// @dev Tolerates ERC-6492 envelope (stripped first), then routes on the
    ///      leading signature-type byte like _validateSignature does.
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override(IAgentAccount, IERC1271) returns (bytes4) {
        bytes memory inner = signature;
        if (signature.length >= 32 && bytes32(signature[signature.length - 32:]) == ERC6492_MAGIC) {
            (, , bytes memory unwrapped) = abi.decode(
                signature[:signature.length - 32],
                (address, bytes, bytes)
            );
            inner = unwrapped;
        }
        return _validateSig(hash, inner) ? ERC1271_MAGIC_VALUE : bytes4(0xffffffff);
    }

    // ─── Signature routing ─────────────────────────────────────────

    uint8 internal constant SIG_TYPE_ECDSA    = 0x00;
    uint8 internal constant SIG_TYPE_WEBAUTHN = 0x01;

    /// @dev Internal dispatcher. Accepts plain 65-byte ECDSA sigs as legacy
    ///      form AND type-prefixed sigs (first byte = SIG_TYPE_*).
    function _validateSig(bytes32 hash, bytes memory sig) internal view returns (bool) {
        // Legacy fast path: bare 65-byte ECDSA sig (no type byte).
        if (sig.length == 65) {
            return _verifyEcdsa(hash, sig);
        }
        if (sig.length < 1) return false;
        uint8 sigType = uint8(sig[0]);
        if (sigType == SIG_TYPE_ECDSA) {
            // 0x00 || <65-byte sig>
            if (sig.length != 66) return false;
            bytes memory inner = new bytes(65);
            for (uint256 i; i < 65; i++) inner[i] = sig[i + 1];
            return _verifyEcdsa(hash, inner);
        }
        if (sigType == SIG_TYPE_WEBAUTHN) {
            // 0x01 || abi.encode(WebAuthnLib.Assertion)
            bytes memory payload = new bytes(sig.length - 1);
            for (uint256 i; i < payload.length; i++) payload[i] = sig[i + 1];
            return _verifyWebAuthn(hash, payload);
        }
        return false;
    }

    function _verifyEcdsa(bytes32 hash, bytes memory sig) internal view returns (bool) {
        // Try raw hash first — matches EntryPoint v0.8 (EIP-712 userOpHash signed directly).
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        if (err == ECDSA.RecoverError.NoError && _owners[recovered]) return true;
        // Fall back to eth-signed-message wrap — matches v0.7 and legacy ERC-1271
        // callers that pre-prefix the digest.
        bytes32 ethSigned = hash.toEthSignedMessageHash();
        (recovered, err,) = ECDSA.tryRecover(ethSigned, sig);
        return err == ECDSA.RecoverError.NoError && _owners[recovered];
    }

    function _verifyWebAuthn(bytes32 hash, bytes memory payload) internal view returns (bool) {
        WebAuthnLib.Assertion memory a = abi.decode(payload, (WebAuthnLib.Assertion));
        PasskeyStorage storage $ = _passkeyStorage();
        PasskeyEntry storage key = $.keys[a.credentialIdDigest];
        if (key.x == 0 && key.y == 0) return false;
        return WebAuthnLib.verify(a, hash, key.x, key.y);
    }

    // ─── Owner Management ───────────────────────────────────────────

    /// @inheritdoc IAgentAccount
    function isOwner(address account) external view override returns (bool) {
        return _owners[account];
    }

    /// @inheritdoc IAgentAccount
    function ownerCount() external view override returns (uint256) {
        return _ownerCount;
    }

    /// @inheritdoc IAgentAccount
    function addOwner(address owner) external override onlySelf {
        if (owner == address(0)) revert ZeroAddress();
        if (_owners[owner]) revert OwnerAlreadyExists(owner);
        _owners[owner] = true;
        _ownerCount++;
        emit OwnerAdded(owner);
    }

    /// @inheritdoc IAgentAccount
    /// @dev Enforces a multi-signer-safe invariant: can't remove the last
    ///      owner if there are also no registered passkeys. A passkey-only
    ///      account is allowed, but a zero-signer account is not.
    function removeOwner(address owner) external override onlySelf {
        if (!_owners[owner]) revert OwnerDoesNotExist(owner);
        if (_ownerCount == 1 && _passkeyStorage().count == 0) revert CannotRemoveLastOwner();
        _owners[owner] = false;
        _ownerCount--;
        emit OwnerRemoved(owner);
    }

    // ─── Passkey (WebAuthn P-256) management ──────────────────────

    /// @dev ERC-7201 namespaced storage slot — isolates passkey state so
    ///      future upgrades can add more signer types without clobbering.
    ///      slot = keccak256(abi.encode(uint256(keccak256("smart-agent.agent-account.passkey.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PASSKEY_STORAGE_SLOT =
        0x3b3ffcf51a0a9bcb2764532549426e303b6d219fffb988d3d097bfc22ad32d00;

    struct PasskeyEntry {
        uint256 x;
        uint256 y;
    }

    struct PasskeyStorage {
        mapping(bytes32 => PasskeyEntry) keys;
        mapping(bytes32 => bool) registered;
        uint256 count;
    }

    function _passkeyStorage() private pure returns (PasskeyStorage storage $) {
        bytes32 slot = PASSKEY_STORAGE_SLOT;
        assembly { $.slot := slot }
    }

    event PasskeyAdded(bytes32 indexed credentialIdDigest, uint256 x, uint256 y);
    event PasskeyRemoved(bytes32 indexed credentialIdDigest);

    /// @notice Register a new WebAuthn credential. onlySelf — callable via a
    ///         UserOp signed by any existing signer (owner or another passkey).
    function addPasskey(bytes32 credentialIdDigest, uint256 x, uint256 y) external onlySelf {
        if (x == 0 || y == 0) revert InvalidPasskeyPublicKey();
        PasskeyStorage storage $ = _passkeyStorage();
        if ($.registered[credentialIdDigest]) revert PasskeyAlreadyRegistered(credentialIdDigest);
        $.keys[credentialIdDigest] = PasskeyEntry(x, y);
        $.registered[credentialIdDigest] = true;
        $.count += 1;
        emit PasskeyAdded(credentialIdDigest, x, y);
    }

    /// @notice Remove a registered WebAuthn credential. onlySelf, with a
    ///         "must leave at least one signer" invariant that counts owners
    ///         AND passkeys together.
    function removePasskey(bytes32 credentialIdDigest) external onlySelf {
        PasskeyStorage storage $ = _passkeyStorage();
        if (!$.registered[credentialIdDigest]) revert PasskeyNotRegistered(credentialIdDigest);
        if (_ownerCount + $.count == 1) revert CannotRemoveLastSigner();
        delete $.keys[credentialIdDigest];
        $.registered[credentialIdDigest] = false;
        $.count -= 1;
        emit PasskeyRemoved(credentialIdDigest);
    }

    /// @notice Whether a passkey is registered on this account.
    function hasPasskey(bytes32 credentialIdDigest) external view returns (bool) {
        return _passkeyStorage().registered[credentialIdDigest];
    }

    /// @notice Read the registered passkey public key.
    function getPasskey(bytes32 credentialIdDigest) external view returns (uint256 x, uint256 y) {
        PasskeyEntry storage k = _passkeyStorage().keys[credentialIdDigest];
        return (k.x, k.y);
    }

    /// @notice Total count of registered passkeys.
    function passkeyCount() external view returns (uint256) {
        return _passkeyStorage().count;
    }

    // ─── Receive ETH ────────────────────────────────────────────────

    receive() external payable {}
}
