// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccountFactory.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/AgentAccountResolver.sol";
import "../src/AttributeStorage.sol";
import "../src/AgentPredicates.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

/**
 * @notice Production-shape parity tests for the resolver's authorization
 *         model. After the `msg.sender == agent` early-return added to
 *         `onlyAgentOwner`, three independent caller shapes must work:
 *
 *           1. The agent calling resolver functions FOR ITSELF (this is
 *              how an ERC-4337 userOp lands a write — sender = agent,
 *              callData = `agentAccount.execute(resolver, …, register(self, …))`,
 *              so `msg.sender` at the resolver = agent).
 *
 *           2. A co-owner EOA calling resolver functions for an agent it
 *              co-owns (legacy / deployer-relayed path).
 *
 *           3. An unrelated EOA being rejected with `NotAgentOwner`.
 */
contract AgentAccountResolverSelfRegisterTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    OntologyTermRegistry ontology;
    AgentAccountResolver resolver;

    address coOwnerEoa;
    address randomEoa;
    address agentAlice;
    address agentBob;

    function setUp() public {
        coOwnerEoa = makeAddr("coOwner");
        randomEoa = makeAddr("random");

        entryPoint = new EntryPoint();
        ontology = new OntologyTermRegistry(address(this));
        resolver = new AgentAccountResolver(address(ontology));

        // Factory's serverSigner = coOwnerEoa → every deployed AgentAccount
        // has coOwnerEoa added as a co-owner via AgentAccount.initialize.
        // This mirrors the production wiring where the master signer is a
        // co-owner of every account.
        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(0),
            coOwnerEoa
        );

        // initialOwner = makeAddr("aliceEoa") — a distinct EOA so the
        // co-owner gate is the ONLY path the test contract has to write
        // through (no accidental self-ownership of the test contract).
        agentAlice = address(factory.createAccount(makeAddr("aliceEoa"), 1001));
        agentBob   = address(factory.createAccount(makeAddr("bobEoa"),   1002));

        _registerTerm("atl:displayName", "string");
        _registerTerm("atl:description", "string");
        _registerTerm("atl:isActive", "bool");
        _registerTerm("atl:agentType", "bytes32");
        _registerTerm("atl:aiAgentClass", "bytes32");
        _registerTerm("atl:hasA2AEndpoint", "string");
        _registerTerm("atl:metadataURI", "string");
        _registerTerm("atl:metadataHash", "bytes32");
        _registerTerm("atl:schemaURI", "string");
        _registerTerm("atl:registeredAt", "uint256");
    }

    function _registerTerm(string memory curie, string memory dtype) internal {
        bytes32 id = keccak256(bytes(curie));
        ontology.registerTerm(
            id, curie,
            string.concat("https://agentictrust.io/ontology/core#", curie),
            curie, dtype
        );
    }

    // ─── (1) Smart account self-call ────────────────────────────────────

    /// @dev Forges the production shape: the agent's smart account IS the
    ///      `msg.sender` at the resolver. Under the prior gate this would
    ///      revert with `NotAgentOwner` (because `agent.isOwner(agent)` is
    ///      true, but only because of the implicit self-owner edge case in
    ///      `AgentAccount.isOwner` — flaky to rely on). The new gate
    ///      short-circuits cleanly on `msg.sender == agent`.
    function test_register_self_call_succeeds() public {
        vm.prank(agentAlice);
        resolver.register(
            agentAlice,
            "Alice (self-registered)",
            "Production-shape register via userOp",
            AgentPredicates.TYPE_PERSON,
            bytes32(0),
            ""
        );
        assertTrue(resolver.isRegistered(agentAlice));
        AgentAccountResolver.CoreRecord memory core = resolver.getCore(agentAlice);
        assertEq(core.displayName, "Alice (self-registered)");
    }

    /// @dev Same shape for `setStringProperty` — the agent should be able
    ///      to write its OWN properties without an external co-owner relay.
    function test_set_property_self_call_succeeds() public {
        vm.prank(agentAlice);
        resolver.register(agentAlice, "Alice", "", AgentPredicates.TYPE_PERSON, bytes32(0), "");

        vm.prank(agentAlice);
        resolver.setStringProperty(
            agentAlice,
            AgentPredicates.ATL_A2A_ENDPOINT,
            "https://alice.agent.localhost"
        );
        assertEq(
            resolver.getStringProperty(agentAlice, AgentPredicates.ATL_A2A_ENDPOINT),
            "https://alice.agent.localhost"
        );
    }

    // ─── (2) Co-owner relay ─────────────────────────────────────────────

    /// @dev The legacy path still works — the deployer / master EOA is a
    ///      co-owner on every factory-minted account, so a co-owner-signed
    ///      tx routes through the existing `isOwner` staticcall branch.
    function test_register_via_coowner_succeeds() public {
        vm.prank(coOwnerEoa);
        resolver.register(
            agentAlice,
            "Alice (co-owner relayed)",
            "Legacy deployer-relayed register",
            AgentPredicates.TYPE_PERSON,
            bytes32(0),
            ""
        );
        assertTrue(resolver.isRegistered(agentAlice));
    }

    // ─── (3) Random EOA is rejected ─────────────────────────────────────

    /// @dev An EOA that is neither the agent itself nor a co-owner must
    ///      bounce off `onlyAgentOwner` with `NotAgentOwner`.
    function test_register_unrelated_eoa_reverts() public {
        vm.prank(randomEoa);
        vm.expectRevert(AgentAccountResolver.NotAgentOwner.selector);
        resolver.register(agentAlice, "X", "", bytes32(0), bytes32(0), "");
    }

    /// @dev An agent cannot write for a DIFFERENT agent it doesn't own —
    ///      `msg.sender == agent` only authorizes writes against `agent`
    ///      itself. (Specifically: `agentBob` is not in `agentAlice`'s
    ///      owner set, and the new modifier does not short-circuit
    ///      because `msg.sender (== agentBob) != agent (== agentAlice)`.)
    function test_other_agent_cannot_register_for_alice_reverts() public {
        vm.prank(agentBob);
        vm.expectRevert(AgentAccountResolver.NotAgentOwner.selector);
        resolver.register(agentAlice, "X", "", bytes32(0), bytes32(0), "");
    }
}
