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

/**
 * @title AgentRootAccount
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
contract AgentRootAccount is BaseAccount, Initializable, UUPSUpgradeable, IAgentAccount, IERC1271 {
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
     * @notice Initialize the account with an initial owner and optional DelegationManager.
     * @param initialOwner The first owner of this agent account.
     * @param dm The DelegationManager address (ERC-7710 executor). Use address(0) to skip.
     */
    function initialize(address initialOwner, address dm) external initializer {
        if (initialOwner == address(0)) revert ZeroAddress();
        _owners[initialOwner] = true;
        _ownerCount = 1;
        _delegationManager = dm;
        emit OwnerAdded(initialOwner);
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

    // ─── ERC-4337 ───────────────────────────────────────────────────

    /// @inheritdoc BaseAccount
    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @inheritdoc BaseAccount
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256 validationData) {
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(userOp.signature);
        if (_owners[recovered]) {
            return 0; // valid
        }
        return 1; // SIG_VALIDATION_FAILED
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

    /// @inheritdoc IERC1271
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override(IAgentAccount, IERC1271) returns (bytes4) {
        bytes32 ethSignedHash = hash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        if (_owners[recovered]) {
            return ERC1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
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
    function removeOwner(address owner) external override onlySelf {
        if (!_owners[owner]) revert OwnerDoesNotExist(owner);
        if (_ownerCount == 1) revert CannotRemoveLastOwner();
        _owners[owner] = false;
        _ownerCount--;
        emit OwnerRemoved(owner);
    }

    // ─── Receive ETH ────────────────────────────────────────────────

    receive() external payable {}
}
