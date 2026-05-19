// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./AgentAccount.sol";
import "./governance/GovernanceManaged.sol";

/**
 * @title AgentAccountFactory
 * @notice Factory for deploying AgentAccount proxies with deterministic CREATE2 addresses.
 *
 * Phase A (spec 007 — architecture hardening) — capability role split:
 *   - `bundlerSigner` and `sessionIssuer` are factory-level capability
 *     roles. They are NEVER added to any account's `_owners` set. Each
 *     deployed account reads them from this factory via the
 *     `bundlerSigner()` / `sessionIssuer()` views.
 *
 * Phase A.5 (K1-Q1 resolution): both role addresses are now MUTABLE
 *     storage gated by the `Governance` multisig. Rotation flows through
 *     a governance proposal + 48h timelock and propagates AUTOMATICALLY
 *     to every existing AgentAccount (each account resolves the role
 *     through the factory at call time). The factory address stays
 *     stable; only the role addresses move.
 *
 *   - The previous third-arg "system co-owner" field (which made the
 *     master signer a co-owner of every deployed AgentAccount) is
 *     removed. Master can never sign userOps for a user account
 *     post-Phase-A.
 *
 * The factory itself remains the canonical address-resolution surface
 * for downstream services that need to know "who is the bundler" or
 * "who is the session-issuer" without per-account chain calls.
 */
contract AgentAccountFactory is GovernanceManaged {
    /// @notice The AgentAccount implementation (singleton).
    AgentAccount public immutable accountImplementation;

    /// @notice The DelegationManager address set on every new account.
    address public immutable delegationManager;

    /// @notice EOA authorized to submit ERC-4337 EntryPoint envelopes
    ///         (the bundler). Phase A.5 — MUTABLE under governance.
    address public bundlerSigner;

    /// @notice EOA authorized to co-sign session delegations the user
    ///         has pre-authorized. Phase A.5 — MUTABLE under governance.
    address public sessionIssuer;

    /// @notice Emitted when a new agent account is deployed.
    /// @dev System-key addresses intentionally omitted from the event —
    ///      they are factory-scoped, not per-account.
    event AgentAccountCreated(address indexed account, address indexed owner, uint256 salt);

    /// @notice Emitted when governance rotates the bundler signer EOA.
    event BundlerSignerChanged(address indexed oldVal, address indexed newVal);

    /// @notice Emitted when governance rotates the session-issuer EOA.
    event SessionIssuerChanged(address indexed oldVal, address indexed newVal);

    /// @dev Storage gap reserves slots for future upgrades. Phase A.5
    ///      (SC7 § 3.1) — every contract with state ends with a gap so
    ///      additive upgrades don't shift downstream slots. The factory
    ///      itself is not upgradeable today, but the gap keeps options
    ///      open and standardises our storage discipline.
    uint256[50] private __gap;

    constructor(
        IEntryPoint entryPoint_,
        address delegationManager_,
        address bundlerSigner_,
        address sessionIssuer_,
        address governance_
    ) GovernanceManaged(governance_) {
        accountImplementation = new AgentAccount(entryPoint_);
        delegationManager = delegationManager_;
        bundlerSigner = bundlerSigner_;
        sessionIssuer = sessionIssuer_;
        emit BundlerSignerChanged(address(0), bundlerSigner_);
        emit SessionIssuerChanged(address(0), sessionIssuer_);
    }

    // ─── Governance-only setters ─────────────────────────────────────

    /// @notice Rotate the bundler signer EOA. Phase A.5 K1-Q1.
    /// @dev Callable only by the Governance contract executing a
    ///      passed proposal. Existing AgentAccount instances pick up
    ///      the new address automatically via `factory().bundlerSigner()`.
    function setBundlerSigner(address newBundler) external onlyGovernance {
        address old = bundlerSigner;
        bundlerSigner = newBundler;
        emit BundlerSignerChanged(old, newBundler);
    }

    /// @notice Rotate the session-issuer EOA. Phase A.5 K1-Q1.
    function setSessionIssuer(address newIssuer) external onlyGovernance {
        address old = sessionIssuer;
        sessionIssuer = newIssuer;
        emit SessionIssuerChanged(old, newIssuer);
    }

    /**
     * @notice Deploy a new AgentAccount proxy, or return the existing one if already deployed.
     * @param owner The initial owner of the agent account.
     * @param salt A unique salt for deterministic deployment.
     * @return account The deployed (or existing) agent account.
     */
    function createAccount(
        address owner,
        uint256 salt
    ) external returns (AgentAccount account) {
        address addr = getAddress(owner, salt);

        // If already deployed, return existing
        if (addr.code.length > 0) {
            return AgentAccount(payable(addr));
        }

        // Deploy ERC1967Proxy pointing to the implementation. The
        // account reads bundlerSigner / sessionIssuer from THIS factory
        // (address(this)) at runtime — no per-account storage needed.
        bytes memory initData = abi.encodeCall(
            AgentAccount.initialize,
            (owner, delegationManager, address(this))
        );

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            initData
        );

        account = AgentAccount(payable(address(proxy)));
        emit AgentAccountCreated(address(account), owner, salt);
    }

    /**
     * @notice Compute the counterfactual address of an agent account.
     * @param owner The initial owner.
     * @param salt The deployment salt.
     * @return The deterministic address.
     */
    function getAddress(
        address owner,
        uint256 salt
    ) public view returns (address) {
        bytes memory initData = abi.encodeCall(
            AgentAccount.initialize,
            (owner, delegationManager, address(this))
        );

        bytes memory proxyBytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(accountImplementation), initData)
        );

        bytes32 bytecodeHash = keccak256(proxyBytecode);

        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            bytes32(salt),
                            bytecodeHash
                        )
                    )
                )
            )
        );
    }
}
