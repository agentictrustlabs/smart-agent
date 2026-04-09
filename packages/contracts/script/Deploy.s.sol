// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/AgentAccountFactory.sol";
import "../src/DelegationManager.sol";
import "../src/enforcers/TimestampEnforcer.sol";
import "../src/enforcers/ValueEnforcer.sol";
import "../src/enforcers/AllowedTargetsEnforcer.sol";
import "../src/enforcers/AllowedMethodsEnforcer.sol";
import "../src/AgentRelationship.sol";
import "../src/AgentAssertion.sol";
import "../src/AgentRelationshipResolver.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

/**
 * @title Deploy
 * @notice Deploys all Agent Smart Account Kit contracts.
 *
 * Usage:
 *   # Local Anvil:
 *   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *
 *   # Sepolia:
 *   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    // ERC-4337 EntryPoint v0.7 canonical address
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. EntryPoint — use canonical if deployed, otherwise deploy for local testing
        IEntryPoint entryPoint;
        if (ENTRYPOINT_V07.code.length > 0) {
            entryPoint = IEntryPoint(ENTRYPOINT_V07);
            console.log("EntryPoint (existing):", ENTRYPOINT_V07);
        } else {
            EntryPoint ep = new EntryPoint();
            entryPoint = IEntryPoint(address(ep));
            console.log("EntryPoint (deployed):", address(ep));
        }

        // 2. AgentAccountFactory (deploys the implementation singleton internally)
        AgentAccountFactory factory = new AgentAccountFactory(entryPoint);
        console.log("AgentAccountFactory:", address(factory));
        console.log("  AgentRootAccount impl:", address(factory.accountImplementation()));

        // 3. DelegationManager
        DelegationManager delegationManager = new DelegationManager();
        console.log("DelegationManager:", address(delegationManager));

        // 4. Caveat Enforcers
        TimestampEnforcer timestampEnforcer = new TimestampEnforcer();
        console.log("TimestampEnforcer:", address(timestampEnforcer));

        ValueEnforcer valueEnforcer = new ValueEnforcer();
        console.log("ValueEnforcer:", address(valueEnforcer));

        AllowedTargetsEnforcer allowedTargetsEnforcer = new AllowedTargetsEnforcer();
        console.log("AllowedTargetsEnforcer:", address(allowedTargetsEnforcer));

        AllowedMethodsEnforcer allowedMethodsEnforcer = new AllowedMethodsEnforcer();
        console.log("AllowedMethodsEnforcer:", address(allowedMethodsEnforcer));

        // 5. Relationship Protocol (3 contracts)
        AgentRelationship agentRelationship = new AgentRelationship();
        console.log("AgentRelationship:", address(agentRelationship));

        AgentAssertion agentAssertion = new AgentAssertion(address(agentRelationship));
        console.log("AgentAssertion:", address(agentAssertion));

        AgentRelationshipResolver agentResolver = new AgentRelationshipResolver(
            address(agentRelationship), address(agentAssertion)
        );
        console.log("AgentRelationshipResolver:", address(agentResolver));

        vm.stopBroadcast();

        // Print env vars for copy-paste into apps/web/.env
        console.log("");
        console.log("=== Copy to apps/web/.env ===");
        _logEnv("ENTRYPOINT_ADDRESS", address(entryPoint));
        _logEnv("AGENT_FACTORY_ADDRESS", address(factory));
        _logEnv("DELEGATION_MANAGER_ADDRESS", address(delegationManager));
        _logEnv("AGENT_RELATIONSHIP_ADDRESS", address(agentRelationship));
        _logEnv("AGENT_ASSERTION_ADDRESS", address(agentAssertion));
        _logEnv("AGENT_RESOLVER_ADDRESS", address(agentResolver));
        _logEnv("TIMESTAMP_ENFORCER_ADDRESS", address(timestampEnforcer));
        _logEnv("VALUE_ENFORCER_ADDRESS", address(valueEnforcer));
        _logEnv("ALLOWED_TARGETS_ENFORCER_ADDRESS", address(allowedTargetsEnforcer));
        _logEnv("ALLOWED_METHODS_ENFORCER_ADDRESS", address(allowedMethodsEnforcer));
    }

    function _logEnv(string memory key, address addr) internal pure {
        console.log(string.concat(key, "=", vm.toString(addr)));
    }
}
