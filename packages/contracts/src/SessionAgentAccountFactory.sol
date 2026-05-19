// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./AgentAccount.sol";
import "./AgentAccountFactory.sol";

/**
 * @title SessionAgentAccountFactory
 * @notice Deploys a session-scoped AgentAccount and atomically installs a
 *         set of first-party ERC-7579 modules in one transaction. Phase 3
 *         of the delegation refactor — used by a2a-agent's `/session/init`
 *         when the requested ToolPolicy is `executionPath='session-account'`.
 *
 *   Wrap pattern:
 *     1. Deploy an ERC1967Proxy pointing at AgentAccount's implementation
 *        (read from the wrapped AgentAccountFactory).
 *     2. initializeWithCoOwner(owner=desiredOwner, coOwner=THIS_FACTORY, dm=dm, factory_=THIS_FACTORY).
 *        Two owners get set: the user (`desiredOwner`) and this factory
 *        (so this factory can call installModule). The fourth arg is
 *        the factory-for-capability-lookups address (Spec 007 Phase A).
 *     3. Install each validator (type 1) and hook (type 4) with the
 *        provided init blob.
 *     4. Self-revoke: factory calls account.removeOwner(factory) by routing
 *        through the account's own execute path via the temporary owner.
 *
 *   `removeOwner` is `onlySelf` on AgentAccount. The factory therefore can't
 *   directly call removeOwner; it must trigger a self-call. The cleanest
 *   way: AgentAccount's execute is owner-gated when msg.sender ∈
 *   {entryPoint, address(this), delegationManager}. So the factory (as an
 *   owner-coowner) can't call execute. But it can install modules because
 *   installModule is owner-OR-self.
 *
 *   Pragmatic v1: leave the factory as a co-owner. The factory has no
 *   admin functions that touch the account post-deploy — it can only call
 *   installModule for THIS specific account ID once. Risk: a future
 *   factory upgrade could exploit lingering ownership, so we make the
 *   factory's address part of the audit trail and document the cleanup
 *   path (user can call `account.removeOwner(factoryAddress)` from any
 *   UserOp later).
 */
contract SessionAgentAccountFactory {
    AgentAccountFactory public immutable accountFactory;
    AgentAccount public immutable accountImplementation;
    address public immutable delegationManager;

    event SessionAgentAccountDeployed(
        address indexed account,
        address indexed owner,
        bytes32 indexed salt,
        uint256 validatorCount,
        uint256 hookCount
    );

    error LengthMismatch();
    error ZeroAddress();
    error AlreadyDeployed(address account);

    constructor(AgentAccountFactory _accountFactory) {
        accountFactory = _accountFactory;
        accountImplementation = _accountFactory.accountImplementation();
        delegationManager = _accountFactory.delegationManager();
    }

    /**
     * @notice Deploy a SessionAgentAccount and atomically install all
     *         specified validators (type 1) + hooks (type 4).
     * @param owner             Primary owner of the new account. For Phase 3
     *                          stateful sessions, the a2a-agent passes a
     *                          session-key EOA here — that EOA signs UserOps
     *                          and the installed hooks gate every call.
     *                          (User-side authority is mediated via the
     *                          DelegationManager chain `user.smartAccount →
     *                          sessionAgentAccount`, not via direct ownership.)
     * @param salt              Deterministic salt — `keccak256(userAddr, sessionId)` is
     *                          the canonical convention used by a2a-agent.
     * @param validators        Validator module addresses (ERC-7579 type 1).
     * @param validatorInits    Per-validator initData (length must match `validators`).
     * @param hooks             Hook module addresses (ERC-7579 type 4).
     * @param hookInits         Per-hook initData (length must match `hooks`).
     * @return account          Address of the newly deployed AgentAccount proxy.
     */
    function deploySession(
        address owner,
        bytes32 salt,
        address[] calldata validators,
        bytes[] calldata validatorInits,
        address[] calldata hooks,
        bytes[] calldata hookInits
    ) external returns (address account) {
        if (owner == address(0)) revert ZeroAddress();
        if (validators.length != validatorInits.length) revert LengthMismatch();
        if (hooks.length != hookInits.length) revert LengthMismatch();

        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) revert AlreadyDeployed(predicted);

        // Deploy with the user-supplied `owner` as the primary owner AND
        // THIS factory as the transient co-owner. Two-owner pattern:
        //   - `owner` (the session-key EOA) signs UserOps + manages day-to-day.
        //   - The factory is a transient co-owner present so it can
        //     installModule on the new proxy. Documented as a no-op
        //     liability post-deploy (no callback paths into the account).
        //     The owner can `removeOwner(factory)` from any UserOp later.
        // Spec 007 Phase A — session bootstrap uses the two-owner
        // initializer so this factory can `installModule` at deploy
        // time. The user-supplied `owner` is the primary owner; this
        // factory is the transient co-owner. `address(this)` is also
        // passed as the factory-for-capability-lookups, satisfying
        // `bundlerSigner()` / `sessionIssuer()` via the delegating
        // views below.
        bytes memory initData = abi.encodeCall(
            AgentAccount.initializeWithCoOwner,
            (owner, address(this), delegationManager, address(this))
        );
        ERC1967Proxy proxy = new ERC1967Proxy{salt: salt}(
            address(accountImplementation),
            initData
        );
        account = address(proxy);

        AgentAccount aa = AgentAccount(payable(account));

        // Install validators (type 1)
        for (uint256 i = 0; i < validators.length; i++) {
            aa.installModule(1, validators[i], validatorInits[i]);
        }
        // Install hooks (type 4)
        for (uint256 i = 0; i < hooks.length; i++) {
            aa.installModule(4, hooks[i], hookInits[i]);
        }

        emit SessionAgentAccountDeployed(account, owner, salt, validators.length, hooks.length);

        // Note: this factory remains a co-owner on the account. It has no
        // callback functions that touch the account after this, so it's
        // effectively inert. The user can `removeOwner(factory)` from a
        // UserOp at any time to clean up the ownership set.
    }

    /// @notice Spec 007 Phase A — delegate capability-role lookups
    ///         to the wrapped main factory. Session accounts read
    ///         `bundlerSigner()` / `sessionIssuer()` off this
    ///         contract, which in turn reads the main factory.
    function bundlerSigner() external view returns (address) {
        return accountFactory.bundlerSigner();
    }

    function sessionIssuer() external view returns (address) {
        return accountFactory.sessionIssuer();
    }

    /// @notice Counterfactual address of a session account given (owner, salt).
    function getAddress(address owner, bytes32 salt) public view returns (address) {
        // Spec 007 Phase A — session bootstrap uses the two-owner
        // initializer so this factory can `installModule` at deploy
        // time. The user-supplied `owner` is the primary owner; this
        // factory is the transient co-owner. `address(this)` is also
        // passed as the factory-for-capability-lookups, satisfying
        // `bundlerSigner()` / `sessionIssuer()` via the delegating
        // views below.
        bytes memory initData = abi.encodeCall(
            AgentAccount.initializeWithCoOwner,
            (owner, address(this), delegationManager, address(this))
        );
        bytes memory proxyBytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(accountImplementation), initData)
        );
        bytes32 bytecodeHash = keccak256(proxyBytecode);
        return address(
            uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                bytecodeHash
            ))))
        );
    }
}
