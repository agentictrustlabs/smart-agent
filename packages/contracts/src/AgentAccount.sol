// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/core/BaseAccount.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "./IAgentAccount.sol";
import "./libraries/WebAuthnLib.sol";

/// @dev Minimal subset of AgentAccountFactory's surface used by the
///      account to look up factory-scoped capability roles. We avoid a
///      hard import of AgentAccountFactory to prevent a circular type
///      dependency at compile time.
interface IAgentAccountFactoryView {
    function bundlerSigner() external view returns (address);
    function sessionIssuer() external view returns (address);
}

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
contract AgentAccount is BaseAccount, Initializable, UUPSUpgradeable, ReentrancyGuard, IAgentAccount, IERC1271 {
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

    /// @dev Spec 007 Phase A — the factory that deployed this account.
    ///      `bundlerSigner()` and `sessionIssuer()` are read off this
    ///      address on each capability check, so a future factory
    ///      upgrade can rotate either role without per-account
    ///      migration. Set once during `initialize`. Zero is tolerated
    ///      for legacy / direct-deploy paths (no bundler envelope path
    ///      enabled).
    address private _factory;

    /// @dev Spec 007 Phase A (Variant B) — set of session-delegation
    ///      hashes the owner has pre-authorized on chain. The
    ///      DelegationManager consults this set at redeem time when a
    ///      high-risk session is in play; this is the on-chain
    ///      counterpart to the off-chain caveated delegation used in
    ///      Variant A.
    mapping(bytes32 => bool) private _acceptedSessionDelegations;

    /// @dev Spec 007 Phase A.5 — optional per-account upgrade delay
    ///      (seconds). 0 (default) keeps backward-compat: upgrades fire
    ///      immediately on owner sig. Owners can opt in to a delay via
    ///      `setUpgradeTimelock`.
    uint256 private _upgradeTimelock;

    struct PendingUpgrade {
        address newImplementation;
        uint64 readyAt;        // UNIX seconds; 0 = no pending upgrade
    }

    /// @dev Spec 007 Phase A.5 — current pending upgrade (set by
    ///      `upgradeToWithAuthorization` when `_upgradeTimelock > 0`).
    PendingUpgrade private _pendingUpgrade;

    /// @dev Spec 007 Phase A.5 — maximum permitted upgrade timelock to
    ///      protect against an owner accidentally setting an absurdly
    ///      large delay that bricks future migrations.
    uint256 internal constant MAX_UPGRADE_TIMELOCK = 30 days;

    /// @dev Spec 007 Phase A.5 (SC7 § 3.1) — storage gap reserves 50
    ///      slots after the last linear-layout state variable. Future
    ///      additive upgrades shrink the gap by however many slots they
    ///      add. ERC-7201 namespaced state (passkeys, modules) lives at
    ///      keccak-computed slots and is NOT in this linear layout.
    uint256[50] private __gap;

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

    // Phase A errors (spec 007).
    error NotEntryPoint();
    error NotBundler();
    error NotOwnerSig();
    error InvalidInnerSignature();
    error FactoryNotSet();
    error SessionDelegationAlreadyAccepted(bytes32 hash);

    // Phase A.5 errors (spec 007).
    error UpgradeTimelockTooLong(uint256 secs, uint256 max);
    error NoPendingUpgrade();
    error UpgradeNotReady(uint64 readyAt, uint256 nowTs);
    error PendingUpgradeMismatch(address pending, address attempted);
    error UpgradePending();

    // ─── Phase A events ─────────────────────────────────────────────

    /// @notice Emitted by `acceptSessionDelegation` — the owner has
    ///         registered the given session-delegation hash on chain.
    event SessionDelegationAccepted(bytes32 indexed sessionDelegationHash);

    /// @notice Emitted by `upgradeToWithAuthorization` after the owner
    ///         signature is verified, before the underlying UUPS
    ///         upgrade fires. Provides an auditable on-chain witness
    ///         that THIS specific owner authorized the upgrade.
    event UpgradeAuthorized(address indexed newImplementation);

    /// @notice Emitted when an owner queues an upgrade that has to wait
    ///         out the per-account timelock (Phase A.5).
    event UpgradeProposed(address indexed newImplementation, uint64 readyAt);

    /// @notice Emitted when the queued upgrade is cancelled by the owner
    ///         during the wait window.
    event UpgradeCancelled(address indexed newImplementation);

    /// @notice Emitted when the per-account upgrade timelock is changed.
    event UpgradeTimelockChanged(uint256 oldValue, uint256 newValue);

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
     * @notice Initialize the account with an initial owner, the
     *         DelegationManager, and the factory address.
     *
     *         Spec 007 Phase A: the master / bundler / session-issuer
     *         keys are NOT added to `_owners`. The factory address is
     *         stored so the account can resolve `bundlerSigner()` and
     *         `sessionIssuer()` on demand. This lets a future factory
     *         upgrade rotate those roles without per-account
     *         migration. If `factory_` is `address(0)` the account
     *         supports the legacy / test path (no bundler envelope or
     *         session-issuer capability checks).
     *
     * @param initialOwner The primary owner of this agent account (user's EOA).
     * @param dm The DelegationManager address (ERC-7710 executor). Use address(0) to skip.
     * @param factory_ The factory that deployed this account. Pass
     *                 address(0) for legacy/test paths.
     */
    function initialize(address initialOwner, address dm, address factory_) external initializer {
        if (initialOwner == address(0)) revert ZeroAddress();
        _owners[initialOwner] = true;
        _ownerCount = 1;
        emit OwnerAdded(initialOwner);

        _delegationManager = dm;
        _factory = factory_;
    }

    /**
     * @notice Two-owner initializer used by `SessionAgentAccountFactory`
     *         when bootstrapping session-scoped accounts whose modules
     *         must be installed by the factory at deploy time.
     *
     *         This path intentionally co-owns the account at init —
     *         the second owner is the FACTORY itself, so it can call
     *         `installModule` (owner-gated) before stepping back. It
     *         is NOT used by the main `AgentAccountFactory` (user
     *         accounts are single-owner under Phase A).
     *
     *         The co-owner is removable post-bootstrap via a userOp
     *         signed by the primary owner (`addOwner` / `removeOwner`
     *         are `onlySelf` — see `SessionAgentAccountFactory.sol`
     *         for the documented cleanup path).
     */
    function initializeWithCoOwner(
        address initialOwner,
        address coOwner,
        address dm,
        address factory_
    ) external initializer {
        if (initialOwner == address(0)) revert ZeroAddress();
        _owners[initialOwner] = true;
        _ownerCount = 1;
        emit OwnerAdded(initialOwner);
        if (coOwner != address(0) && coOwner != initialOwner) {
            _owners[coOwner] = true;
            _ownerCount = 2;
            emit OwnerAdded(coOwner);
        }
        _delegationManager = dm;
        _factory = factory_;
    }

    // ─── UUPS Upgrade ──────────────────────────────────────────────

    /**
     * @dev Spec 007 Phase A — `_authorizeUpgrade` requires `msg.sender
     *      == address(this)`. The ONLY path that satisfies this is a
     *      re-entrant call from `upgradeToWithAuthorization` (below),
     *      which verifies an explicit owner signature first. Direct
     *      callers of `upgradeToAndCall` cannot satisfy `onlySelf` and
     *      will revert here. Master / bundler / session-issuer
     *      therefore cannot upgrade even by submitting the tx.
     */
    function _authorizeUpgrade(address) internal view override onlySelf {}

    /**
     * @notice Upgrade the implementation, gated by an explicit owner
     *         signature. Spec 007 Phase A (D2 / acceptance criterion
     *         "test_MasterCannotUpgrade").
     *
     *         The owner signs `keccak256(abi.encode("UPGRADE",
     *         newImpl, address(this), block.chainid))` (raw or
     *         eth-signed wrap, both accepted by `_verifyEcdsa`). Any
     *         caller can submit the tx — what matters is whose
     *         signature the bytes recover to. Master / bundler /
     *         session-issuer can submit but cannot authorize.
     *
     * @param newImpl The new implementation address.
     * @param ownerSig The owner's ECDSA signature over the upgrade
     *                 digest. Bare 65-byte or 0x00-type-byte-prefixed
     *                 forms both accepted (matches `_verifyEcdsa`).
     */
    function upgradeToWithAuthorization(address newImpl, bytes calldata ownerSig) external {
        if (newImpl == address(0)) revert ZeroAddress();
        bytes32 digest = keccak256(
            abi.encode(
                bytes32("UPGRADE"),
                newImpl,
                address(this),
                block.chainid
            )
        );
        if (!_verifyEcdsa(digest, ownerSig)) revert NotOwnerSig();

        // Phase A.5 — if a per-account timelock is configured, queue
        // the upgrade instead of executing immediately. The user can
        // cancel it during the window via `cancelPendingUpgrade`; the
        // execution happens via `executePendingUpgrade()` after the
        // window expires.
        if (_upgradeTimelock != 0) {
            // Refuse to queue if an upgrade is already pending. The
            // owner must cancel the current one first; otherwise a
            // stolen owner-sig could displace a benign pending upgrade.
            if (_pendingUpgrade.readyAt != 0) revert UpgradePending();
            uint64 readyAt = uint64(block.timestamp + _upgradeTimelock);
            _pendingUpgrade = PendingUpgrade({
                newImplementation: newImpl,
                readyAt: readyAt
            });
            emit UpgradeProposed(newImpl, readyAt);
            return;
        }

        emit UpgradeAuthorized(newImpl);
        // Self-call into the standard UUPS path so the `_authorizeUpgrade`
        // `onlySelf` gate is satisfied. `upgradeToAndCall(newImpl, "")`
        // is equivalent to the historical `upgradeTo(newImpl)`.
        this.upgradeToAndCall(newImpl, "");
    }

    /// @notice Execute a previously-queued upgrade. Permissionless once
    ///         the timelock has expired — anyone can pay the gas, but
    ///         the implementation address was bound at queue time.
    function executePendingUpgrade() external {
        PendingUpgrade memory p = _pendingUpgrade;
        if (p.readyAt == 0) revert NoPendingUpgrade();
        if (block.timestamp < p.readyAt) revert UpgradeNotReady(p.readyAt, block.timestamp);
        // Clear pending BEFORE the upgrade fires so a misbehaving new
        // impl can't replay this state.
        delete _pendingUpgrade;
        emit UpgradeAuthorized(p.newImplementation);
        this.upgradeToAndCall(p.newImplementation, "");
    }

    /// @notice Cancel a queued upgrade during the timelock window. Owner
    ///         signs a digest that binds to the pending implementation
    ///         AND `address(this)` + chain id, preventing cross-account
    ///         replay of a cancel-grant.
    /// @param ownerSig Owner ECDSA signature over `keccak256(abi.encode(
    ///                 "UPGRADE_CANCEL", _pendingUpgrade.newImplementation,
    ///                 address(this), block.chainid))`.
    function cancelPendingUpgrade(bytes calldata ownerSig) external {
        PendingUpgrade memory p = _pendingUpgrade;
        if (p.readyAt == 0) revert NoPendingUpgrade();
        bytes32 digest = keccak256(
            abi.encode(
                bytes32("UPGRADE_CANCEL"),
                p.newImplementation,
                address(this),
                block.chainid
            )
        );
        if (!_verifyEcdsa(digest, ownerSig)) revert NotOwnerSig();
        delete _pendingUpgrade;
        emit UpgradeCancelled(p.newImplementation);
    }

    /// @notice Configure the per-account upgrade timelock (seconds).
    ///         Settable only via a userOp the owner signed
    ///         (`onlySelf`). 0 == immediate upgrades (default,
    ///         backward-compat).
    function setUpgradeTimelock(uint256 secs) external onlySelf {
        if (secs > MAX_UPGRADE_TIMELOCK) {
            revert UpgradeTimelockTooLong(secs, MAX_UPGRADE_TIMELOCK);
        }
        uint256 old = _upgradeTimelock;
        _upgradeTimelock = secs;
        emit UpgradeTimelockChanged(old, secs);
    }

    /// @notice Current per-account upgrade timelock (seconds).
    function upgradeTimelock() external view returns (uint256) {
        return _upgradeTimelock;
    }

    /// @notice Current pending-upgrade state.
    function pendingUpgrade() external view returns (address newImpl, uint64 readyAt) {
        PendingUpgrade memory p = _pendingUpgrade;
        return (p.newImplementation, p.readyAt);
    }

    /// @notice Returns the current implementation version.
    function version() external pure returns (string memory) {
        return "2.2.0";
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

    // ─── Phase A — capability roles (factory-scoped) ───────────────

    /// @notice Address of the factory that deployed this account.
    function factory() external view returns (address) {
        return _factory;
    }

    /// @notice Bundler signer address. Resolved through the factory so
    ///         a factory upgrade can rotate this without per-account
    ///         migration. Returns address(0) if no factory is set
    ///         (legacy / direct-deploy path).
    function bundlerSigner() public view returns (address) {
        if (_factory == address(0)) return address(0);
        return IAgentAccountFactoryView(_factory).bundlerSigner();
    }

    /// @notice Session-issuer address. Same factory-indirect pattern.
    function sessionIssuer() public view returns (address) {
        if (_factory == address(0)) return address(0);
        return IAgentAccountFactoryView(_factory).sessionIssuer();
    }

    /// @notice True iff the owner has pre-authorized the given
    ///         session-delegation hash on chain (Variant B).
    function hasAcceptedSessionDelegation(bytes32 sessionDelegationHash) external view returns (bool) {
        return _acceptedSessionDelegations[sessionDelegationHash];
    }

    /**
     * @notice Pre-authorize an on-chain session delegation (Variant B).
     *
     *         For high-risk sessions (per spec 007 § D2), the user
     *         signs an EIP-712 message authorising a specific session
     *         delegation hash and submits a userOp that calls this
     *         function. Subsequent session userOps recover their
     *         authority by consulting this set.
     *
     *         The hash itself is opaque to AgentAccount; it MUST
     *         encode the session key, scope, expiry and any other
     *         binding fields. Off-chain layer (DelegationManager)
     *         validates the shape.
     *
     *         Authorization gate: `msg.sender == address(this)`. The
     *         only way to reach this is a userOp signed by an owner
     *         and routed through `execute` → self-call. Master /
     *         bundler / session-issuer cannot register a session by
     *         themselves; they can only submit a userOp the user
     *         already signed.
     *
     * @param sessionDelegationHash The keccak256 hash of the session
     *                              delegation the owner has authorized.
     */
    function acceptSessionDelegation(bytes32 sessionDelegationHash) external onlySelf {
        if (_acceptedSessionDelegations[sessionDelegationHash]) {
            revert SessionDelegationAlreadyAccepted(sessionDelegationHash);
        }
        _acceptedSessionDelegations[sessionDelegationHash] = true;
        emit SessionDelegationAccepted(sessionDelegationHash);
    }

    /**
     * @notice Defense-in-depth wrapper: verify a bundler-envelope
     *         signature AT THE CONTRACT LAYER, then re-enter the
     *         standard ERC-4337 validation path.
     *
     *         Spec 007 Phase A D3 — `executeFromBundler` is an
     *         ADDITIONAL layer ALONGSIDE the standard EntryPoint flow,
     *         not a replacement. It re-checks at the contract layer
     *         what `apps/a2a-agent/src/routes/onchain-redeem.ts`
     *         already checked off-chain.
     *
     *         Authorization gates:
     *           - `bundlerSig` recovers to `bundlerSigner()` over a
     *             digest binding `userOpHash`, `address(this)`, and
     *             `block.chainid`. Master / random callers cannot
     *             impersonate the bundler.
     *           - The inner `op.signature` is validated against
     *             `_owners` (or the WebAuthn passkey set) via the
     *             standard `_validateSig` path. The bundler envelope
     *             alone is insufficient.
     *
     *         This function is purely a verification hook: it does
     *         NOT execute the userOp. EntryPoint.handleOps drives
     *         execution as usual. Off-chain bundler-relay code calls
     *         this view first as a sanity gate before submitting to
     *         EntryPoint, and on-chain tooling can call it to assert
     *         the bundler envelope at the contract layer.
     *
     * @param op The packed userOp envelope being submitted.
     * @param userOpHash The hash EntryPoint will compute for `op`.
     *                   Passed by the caller so the contract doesn't
     *                   need to know EntryPoint version semantics; the
     *                   off-chain relay computes it identically.
     * @param bundlerSig The bundler's signature over
     *                   `keccak256(abi.encode("BUNDLER_ENVELOPE",
     *                   userOpHash, address(this), block.chainid))`.
     * @return true if both layers (bundler envelope + inner signature)
     *         validate. Reverts otherwise.
     */
    function executeFromBundler(
        PackedUserOperation calldata op,
        bytes32 userOpHash,
        bytes calldata bundlerSig
    ) external view returns (bool) {
        address bundler = bundlerSigner();
        if (bundler == address(0)) revert FactoryNotSet();

        bytes32 envelopeDigest = keccak256(
            abi.encode(
                bytes32("BUNDLER_ENVELOPE"),
                userOpHash,
                address(this),
                block.chainid
            )
        );
        if (!_verifySignerEcdsa(envelopeDigest, bundlerSig, bundler)) {
            revert NotBundler();
        }
        // Re-verify the inner userOp signature against the owner set.
        // This is what `_validateSignature` does at EntryPoint time;
        // we re-run it here so a misbehaving off-chain relay can't
        // forge a payload past the bundler check.
        if (!_validateSig(userOpHash, op.signature)) {
            revert InvalidInnerSignature();
        }
        return true;
    }

    // ─── ERC-7579 module config (install/uninstall + introspection) ───
    //
    // Phase 3 of the delegation refactor adds first-party module support
    // for stateful policy (spend caps, rate limits, target allowlists,
    // session validators). Modules are isolated in ERC-7201 namespaced
    // storage so future upgrades can extend the layout without clobbering
    // existing state (owners, passkeys, delegationManager).
    //
    // First-party only at v1 — no third-party module registry. Install
    // and uninstall are owner-gated (or self-gated via UserOp). The
    // DelegationManager cannot install modules; module changes are too
    // sensitive to delegate.

    /// @dev ERC-7579 module type IDs (canonical).
    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;
    uint256 internal constant MODULE_TYPE_EXECUTOR  = 2;
    uint256 internal constant MODULE_TYPE_FALLBACK  = 3;
    uint256 internal constant MODULE_TYPE_HOOK      = 4;

    /// @dev Gas-protection cap: a single account can carry at most this many
    ///      hook modules before installModule reverts. Hooks loop per call so
    ///      an unbounded list would let a malicious owner brick their account.
    uint256 internal constant MAX_HOOKS = 8;

    /// @dev ERC-7201 namespaced storage slot for module state.
    ///      slot = keccak256(abi.encode(uint256(keccak256("smart-agent.account.modules.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MODULES_STORAGE_SLOT =
        0x1f14a6accceab237b8ab0463623403008b2dec742c79d1d0e63a7729f8c11c00;

    struct ModulesStorage {
        // moduleTypeId => module address => installed flag
        mapping(uint256 => mapping(address => bool)) installed;
        // moduleTypeId => ordered list of installed module addresses (for enumeration + hook iteration)
        mapping(uint256 => address[]) installedList;
    }

    function _modulesStorage() private pure returns (ModulesStorage storage $) {
        bytes32 slot = MODULES_STORAGE_SLOT;
        assembly { $.slot := slot }
    }

    // ─── Events ───────────────────────────────────────────────────────

    /// @notice ERC-7579 ModuleInstalled.
    event ModuleInstalled(uint256 moduleTypeId, address module);
    /// @notice ERC-7579 ModuleUninstalled.
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    // ─── Errors ───────────────────────────────────────────────────────

    error UnsupportedModuleType(uint256 moduleTypeId);
    error ModuleAlreadyInstalled(uint256 moduleTypeId, address module);
    error ModuleNotInstalled(uint256 moduleTypeId, address module);
    error TooManyHooks();
    error ModuleOnInstallFailed(bytes reason);
    error ModuleOnUninstallFailed(bytes reason);

    // ─── Auth modifier ────────────────────────────────────────────────

    modifier onlyOwnerOrSelf() {
        if (msg.sender != address(this) && !_owners[msg.sender]) {
            revert NotOwnerOrSelf();
        }
        _;
    }

    /**
     * @notice Install an ERC-7579 module of the given type.
     * @dev Owner-gated (or self via UserOp). Calls `onInstall(initData)` on
     *      the module after marking it installed; if the module reverts in
     *      `onInstall`, the install is aborted — but failure is wrapped in
     *      a typed error so the caller can distinguish from auth failures.
     */
    function installModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata initData
    ) external onlyOwnerOrSelf {
        if (module == address(0)) revert ZeroAddress();
        if (!_isSupportedModuleType(moduleTypeId)) revert UnsupportedModuleType(moduleTypeId);

        ModulesStorage storage $ = _modulesStorage();
        if ($.installed[moduleTypeId][module]) {
            revert ModuleAlreadyInstalled(moduleTypeId, module);
        }
        if (moduleTypeId == MODULE_TYPE_HOOK && $.installedList[moduleTypeId].length >= MAX_HOOKS) {
            revert TooManyHooks();
        }

        $.installed[moduleTypeId][module] = true;
        $.installedList[moduleTypeId].push(module);

        // Notify the module — best-effort wrapped so a misbehaving module
        // produces a typed error instead of bubbling raw bytes. We still
        // revert the install on failure (leaving the storage flag set would
        // create an inconsistent module/`onInstall` state).
        try IERC7579ModuleLike(module).onInstall(initData) {
            // ok
        } catch (bytes memory reason) {
            // Roll back the storage write before reverting.
            $.installed[moduleTypeId][module] = false;
            address[] storage list = $.installedList[moduleTypeId];
            list.pop();
            revert ModuleOnInstallFailed(reason);
        }

        emit ModuleInstalled(moduleTypeId, module);
    }

    /**
     * @notice Uninstall a previously installed ERC-7579 module.
     * @dev Owner-gated. `onUninstall` failure is loud — it reverts. Loud
     *      failure is better than orphan state for security-sensitive
     *      modules (e.g., a spend-cap hook with budget state shouldn't
     *      be removed silently if it can't clean up).
     */
    function uninstallModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata deInitData
    ) external onlyOwnerOrSelf {
        if (!_isSupportedModuleType(moduleTypeId)) revert UnsupportedModuleType(moduleTypeId);

        ModulesStorage storage $ = _modulesStorage();
        if (!$.installed[moduleTypeId][module]) {
            revert ModuleNotInstalled(moduleTypeId, module);
        }

        // Loud uninstall — if the module reverts in onUninstall, we revert
        // too so the caller sees the failure. (Owner can force-uninstall
        // by passing deInitData the module can handle, or by re-deploying
        // the account proxy — UUPS is available.)
        try IERC7579ModuleLike(module).onUninstall(deInitData) {
            // ok
        } catch (bytes memory reason) {
            revert ModuleOnUninstallFailed(reason);
        }

        $.installed[moduleTypeId][module] = false;
        _removeFromList($.installedList[moduleTypeId], module);

        emit ModuleUninstalled(moduleTypeId, module);
    }

    /// @notice Returns true iff the given module is installed for the given type.
    /// @dev `additionalContext` accepted for ERC-7579 conformance; unused here.
    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata /* additionalContext */
    ) external view returns (bool) {
        return _modulesStorage().installed[moduleTypeId][module];
    }

    /// @notice ERC-7579 supportsModule (introspection).
    function supportsModule(uint256 moduleTypeId) external pure returns (bool) {
        return _isSupportedModuleType(moduleTypeId);
    }

    /// @notice ERC-7579 supportsExecutionMode (introspection).
    /// @dev We support the canonical single-call mode (CALLTYPE_SINGLE, EXECTYPE_DEFAULT).
    ///      We don't expose `execute(bytes32 mode, bytes execData)` (the new ERC-7579
    ///      execution surface) — BaseAccount.execute is the canonical entry. We return
    ///      true here for the encoded form of CALLTYPE_SINGLE so 7579-aware tooling
    ///      can introspect the account before routing through our existing path.
    function supportsExecutionMode(bytes32 /* mode */) external pure returns (bool) {
        // Phase 3 surface — we don't support the multiplexed ERC-7579 execute()
        // entry yet; routing remains via BaseAccount.execute. Return false for
        // any encoded mode to avoid misadvertising capability.
        return false;
    }

    /// @notice Enumerate the installed modules for a given type.
    function getInstalledModules(uint256 moduleTypeId) external view returns (address[] memory) {
        return _modulesStorage().installedList[moduleTypeId];
    }

    /**
     * @notice Stable account-implementation identifier.
     * @dev Bumped to `.2` to signal ERC-7579 install/uninstall support.
     */
    function accountId() external pure returns (string memory) {
        return "smart-agent.agent-account.2";
    }

    function _isSupportedModuleType(uint256 moduleTypeId) internal pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR
            || moduleTypeId == MODULE_TYPE_EXECUTOR
            || moduleTypeId == MODULE_TYPE_HOOK;
        // Fallback (type 3) intentionally unsupported in v1 — would require
        // a fallback dispatcher we don't ship yet.
    }

    function _removeFromList(address[] storage list, address module) private {
        uint256 len = list.length;
        for (uint256 i = 0; i < len; i++) {
            if (list[i] == module) {
                if (i != len - 1) list[i] = list[len - 1];
                list.pop();
                return;
            }
        }
        // unreachable — installed flag guarantees presence
    }

    // ─── Hook execution wrapper ───────────────────────────────────────
    //
    // Override BaseAccount.execute to run pre/postCheck on installed hook
    // modules. Authorization (entryPoint / self / delegationManager) is
    // enforced by `_requireForExecute` from BaseAccount unchanged.
    //
    // Hook semantics:
    //   - preCheck runs in install order; each receives (msg.sender, value, msgData).
    //   - The hookData returned by preCheck is fed into postCheck after the call.
    //   - If preCheck reverts the whole execute reverts.
    //   - postCheck only runs on success (the call already reverts on failure).

    /// @inheritdoc BaseAccount
    /// @dev Spec 007 Phase A.5 (SC5 § 6.1) — `nonReentrant` blocks the
    ///      "execute -> target -> execute on the same account" class of
    ///      bugs that downstream stateful enforcers / hooks could enable.
    ///      `_requireForExecute` already restricts callers to
    ///      EntryPoint / self / DelegationManager; the guard hardens
    ///      against a malicious target re-entering through one of those
    ///      callers.
    function execute(address target, uint256 value, bytes calldata data) external override nonReentrant {
        _requireForExecute();

        ModulesStorage storage $ = _modulesStorage();
        address[] memory hooks = $.installedList[MODULE_TYPE_HOOK];
        bytes[] memory hookData = new bytes[](hooks.length);

        // Compose msgData = abi.encodeWithSignature("execute(address,uint256,bytes)", ...)
        // so hook policy can decode the inner call. Easier and cheaper than
        // forwarding msg.data which includes the selector + ABI tail; we
        // rebuild the encoded inner call directly here.
        bytes memory hookMsgData = abi.encode(target, value, data);

        for (uint256 i = 0; i < hooks.length; i++) {
            hookData[i] = IERC7579HookLike(hooks[i]).preCheck(msg.sender, value, hookMsgData);
        }

        // Perform the actual call (mirrors BaseAccount.execute body).
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            // bubble the revert reason
            assembly {
                let len := mload(ret)
                revert(add(ret, 0x20), len)
            }
        }

        for (uint256 i = 0; i < hooks.length; i++) {
            IERC7579HookLike(hooks[i]).postCheck(hookData[i]);
        }
    }

    /// @notice Atomically execute multiple calls from this account.
    /// @dev Overrides BaseAccount.executeBatch to layer the module-hook
    ///      pre/post-check semantics already used by `execute`. Spec 005 —
    ///      pledge honor needs `USDC.transfer(pool, amount)` +
    ///      `PledgeRegistry.recordHonor(...)` in one atomic operation,
    ///      pinned by a `CallDataHashEnforcer` on the redeem path so the
    ///      donor's sub-delegation authorises exactly this calldata.
    ///
    ///      Auth: identical to `execute` — EntryPoint / self / DelegationManager.
    ///      Inner calls run with `msg.sender == address(this)`.
    ///      All-or-nothing: any inner revert bubbles and reverts the batch.
    ///      Pre-hooks run once on the whole batch; post-hooks run on success.
    ///
    ///      Spec 007 Phase A.5 — intentionally NOT `nonReentrant`. The
    ///      DM redeem flow legitimately calls `account.execute(target=self,
    ///      data=executeBatch_calldata)`, which then self-calls into
    ///      `executeBatch`. If both functions held the guard, that
    ///      pattern would revert with `ReentrancyGuardReentrantCall`. The
    ///      OUTER `execute` already holds the guard, so external re-entry
    ///      is blocked; `_requireForExecute` restricts entry to
    ///      EntryPoint / self / DM (DM has its own `nonReentrant`).
    function executeBatch(Call[] calldata calls) external override {
        _requireForExecute();

        ModulesStorage storage $ = _modulesStorage();
        address[] memory hooks = $.installedList[MODULE_TYPE_HOOK];
        bytes[] memory hookData = new bytes[](hooks.length);

        // hookMsgData encodes the full batch so hook policy can inspect
        // every inner call.
        bytes memory hookMsgData = abi.encode(calls);

        for (uint256 i = 0; i < hooks.length; i++) {
            hookData[i] = IERC7579HookLike(hooks[i]).preCheck(msg.sender, 0, hookMsgData);
        }

        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = calls[i].target.call{ value: calls[i].value }(calls[i].data);
            if (!ok) {
                assembly {
                    let len := mload(ret)
                    revert(add(ret, 0x20), len)
                }
            }
        }

        for (uint256 i = 0; i < hooks.length; i++) {
            IERC7579HookLike(hooks[i]).postCheck(hookData[i]);
        }
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

    /// @dev Verify a signature recovers to a SPECIFIC expected signer
    ///      (used by `executeFromBundler` and any future capability
    ///      check that targets a system key, NOT the owner set). Try
    ///      raw hash first then eth-signed wrap, like `_verifyEcdsa`.
    function _verifySignerEcdsa(
        bytes32 hash,
        bytes memory sig,
        address expected
    ) internal pure returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        if (err == ECDSA.RecoverError.NoError && recovered == expected) return true;
        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(hash);
        (recovered, err,) = ECDSA.tryRecover(ethSigned, sig);
        return err == ECDSA.RecoverError.NoError && recovered == expected;
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
    /// @dev An account is implicitly an owner of itself: when a delegation
    ///      chain bottoms out at this AgentAccount as the rootDelegator,
    ///      DelegationManager calls `this.execute(...)` and the resulting
    ///      external call has `msg.sender == address(this)`. Downstream
    ///      `isOwner(msg.sender)` checks (e.g. FundRegistry.onlyFundOwner)
    ///      should pass — the account IS the actor making the call.
    function isOwner(address account) external view override returns (bool) {
        if (account == address(this)) return true;
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

/// @dev Minimal subset of the ERC-7579 module interface we call into.
///      We import the OpenZeppelin draft-IERC7579 only when needed; an inline
///      type-erased shape here avoids pulling the full file at this layer.
interface IERC7579ModuleLike {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
}

interface IERC7579HookLike {
    function preCheck(address msgSender, uint256 value, bytes calldata msgData)
        external returns (bytes memory);
    function postCheck(bytes calldata hookData) external;
}
