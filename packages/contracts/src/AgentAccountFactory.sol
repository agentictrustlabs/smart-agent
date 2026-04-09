// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./AgentRootAccount.sol";

/**
 * @title AgentAccountFactory
 * @notice Factory for deploying AgentRootAccount proxies with deterministic CREATE2 addresses.
 *         Automatically sets the DelegationManager on each new account (ERC-7710).
 */
contract AgentAccountFactory {
    /// @notice The AgentRootAccount implementation (singleton).
    AgentRootAccount public immutable accountImplementation;

    /// @notice The DelegationManager address set on every new account.
    address public delegationManager;

    /// @notice Emitted when a new agent account is deployed.
    event AgentAccountCreated(address indexed account, address indexed owner, uint256 salt);

    constructor(IEntryPoint entryPoint_, address delegationManager_) {
        accountImplementation = new AgentRootAccount(entryPoint_);
        delegationManager = delegationManager_;
    }

    /**
     * @notice Update the DelegationManager for future deployments.
     * @param dm The new DelegationManager address.
     */
    function setDelegationManager(address dm) external {
        delegationManager = dm;
    }

    /**
     * @notice Deploy a new AgentRootAccount proxy, or return the existing one if already deployed.
     * @param owner The initial owner of the agent account.
     * @param salt A unique salt for deterministic deployment.
     * @return account The deployed (or existing) agent account.
     */
    function createAccount(
        address owner,
        uint256 salt
    ) external returns (AgentRootAccount account) {
        address addr = getAddress(owner, salt);

        // If already deployed, return existing
        if (addr.code.length > 0) {
            return AgentRootAccount(payable(addr));
        }

        // Deploy ERC1967Proxy pointing to the implementation
        // initialize(owner, delegationManager) sets both at creation time
        bytes memory initData = abi.encodeCall(
            AgentRootAccount.initialize,
            (owner, delegationManager)
        );

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            initData
        );

        account = AgentRootAccount(payable(address(proxy)));
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
            AgentRootAccount.initialize,
            (owner, delegationManager)
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
