// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccountFactory.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/AgentAccountResolver.sol";
import "../src/AgentPredicates.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract AgentResolverTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    OntologyTermRegistry ontology;
    AgentAccountResolver resolver;

    address alice;
    address bob;
    address agentAlice;
    address agentBob;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        entryPoint = new EntryPoint();
        ontology = new OntologyTermRegistry(address(this));
        resolver = new AgentAccountResolver(address(ontology));
        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));

        // Deploy two agent accounts (this contract is the server signer / co-owner)
        agentAlice = address(factory.createAccount(alice, 1));
        agentBob = address(factory.createAccount(bob, 2));

        // Register required ontology terms
        _registerTerm("atl:displayName", "string");
        _registerTerm("atl:description", "string");
        _registerTerm("atl:isActive", "bool");
        _registerTerm("atl:agentType", "string");
        _registerTerm("atl:aiAgentClass", "string");
        _registerTerm("atl:hasCapability", "string[]");
        _registerTerm("atl:supportedTrustModel", "string[]");
        _registerTerm("atl:hasA2AEndpoint", "string");
        _registerTerm("atl:hasMCPServer", "string");
        _registerTerm("atl:hasController", "address[]");
        _registerTerm("atl:operatedBy", "address");
        _registerTerm("atl:metadataURI", "string");
        _registerTerm("atl:metadataHash", "bytes32");
        _registerTerm("atl:schemaURI", "string");
    }

    function _registerTerm(string memory curie, string memory dtype) internal {
        bytes32 id = keccak256(bytes(curie));
        ontology.registerTerm(id, curie, string.concat("https://agentictrust.io/ontology/core#", curie), curie, dtype);
    }

    // ─── OntologyTermRegistry Tests ─────────────────────────────────

    function test_ontology_term_count() public view {
        assertEq(ontology.termCount(), 14, "Should have 14 registered terms");
    }

    function test_ontology_term_is_registered() public view {
        assertTrue(ontology.isRegistered(AgentPredicates.ATL_DISPLAY_NAME), "displayName should be registered");
        assertTrue(ontology.isActive(AgentPredicates.ATL_DISPLAY_NAME), "displayName should be active");
    }

    function test_ontology_term_not_registered() public view {
        bytes32 fake = keccak256("fake:term");
        assertFalse(ontology.isRegistered(fake), "fake term should not be registered");
    }

    function test_ontology_deactivate_term() public {
        bytes32 id = AgentPredicates.ATL_DISPLAY_NAME;
        assertTrue(ontology.isActive(id));
        ontology.deactivateTerm(id);
        assertFalse(ontology.isActive(id), "term should be deactivated");
        ontology.activateTerm(id);
        assertTrue(ontology.isActive(id), "term should be re-activated");
    }

    function test_ontology_only_governor() public {
        vm.prank(alice);
        vm.expectRevert(OntologyTermRegistry.NotGovernor.selector);
        ontology.registerTerm(bytes32(0), "x", "x", "x", "x");
    }

    function test_ontology_no_duplicate_terms() public {
        bytes32 id = AgentPredicates.ATL_DISPLAY_NAME;
        vm.expectRevert(OntologyTermRegistry.TermExists.selector);
        ontology.registerTerm(id, "dup", "dup", "dup", "dup");
    }

    // ─── AgentAccountResolver Registration Tests ────────────────────

    function test_register_agent() public {
        resolver.register(
            agentAlice, "Alice Agent", "Alice's agent",
            AgentPredicates.TYPE_PERSON, bytes32(0), ""
        );
        assertTrue(resolver.isRegistered(agentAlice), "agent should be registered");
        assertEq(resolver.agentCount(), 1, "should have 1 agent");
    }

    function test_register_sets_core_fields() public {
        resolver.register(
            agentAlice, "My Agent", "Description here",
            AgentPredicates.TYPE_AI_AGENT, AgentPredicates.CLASS_DISCOVERY, "https://schema.example"
        );

        AgentAccountResolver.CoreRecord memory core = resolver.getCore(agentAlice);
        assertEq(core.displayName, "My Agent");
        assertEq(core.description, "Description here");
        assertEq(core.agentType, AgentPredicates.TYPE_AI_AGENT);
        assertEq(core.agentClass, AgentPredicates.CLASS_DISCOVERY);
        assertEq(core.schemaURI, "https://schema.example");
        assertTrue(core.active, "should be active by default");
        assertGt(core.registeredAt, 0, "registeredAt should be set");
    }

    function test_register_reverts_if_not_owner() public {
        vm.prank(bob); // bob is NOT an owner of agentAlice
        vm.expectRevert(AgentAccountResolver.NotAgentOwner.selector);
        resolver.register(agentAlice, "X", "X", bytes32(0), bytes32(0), "");
    }

    function test_register_reverts_if_already_registered() public {
        resolver.register(agentAlice, "A", "A", bytes32(0), bytes32(0), "");
        vm.expectRevert(AgentAccountResolver.AlreadyRegistered.selector);
        resolver.register(agentAlice, "B", "B", bytes32(0), bytes32(0), "");
    }

    // ─── Core Property Update Tests ─────────────────────────────────

    function test_update_core() public {
        resolver.register(agentAlice, "Old", "Old desc", AgentPredicates.TYPE_PERSON, bytes32(0), "");
        resolver.updateCore(agentAlice, "New", "New desc", AgentPredicates.TYPE_AI_AGENT, AgentPredicates.CLASS_VALIDATOR);

        AgentAccountResolver.CoreRecord memory core = resolver.getCore(agentAlice);
        assertEq(core.displayName, "New");
        assertEq(core.description, "New desc");
        assertEq(core.agentType, AgentPredicates.TYPE_AI_AGENT);
        assertEq(core.agentClass, AgentPredicates.CLASS_VALIDATOR);
    }

    function test_set_active() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");
        assertTrue(resolver.getCore(agentAlice).active);
        resolver.setActive(agentAlice, false);
        assertFalse(resolver.getCore(agentAlice).active);
    }

    function test_set_metadata_uri() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");
        bytes32 hash = keccak256("metadata content");
        resolver.setMetadataURI(agentAlice, "ipfs://QmTest123", hash);

        AgentAccountResolver.CoreRecord memory core = resolver.getCore(agentAlice);
        assertEq(core.metadataURI, "ipfs://QmTest123");
        assertEq(core.metadataHash, hash);
    }

    function test_update_reverts_if_not_registered() public {
        vm.expectRevert(AgentAccountResolver.NotRegistered.selector);
        resolver.updateCore(agentAlice, "X", "X", bytes32(0), bytes32(0));
    }

    // ─── Generic Property Tests ─────────────────────────────────────

    function test_set_string_property() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        bytes32 pred = AgentPredicates.ATL_A2A_ENDPOINT;
        resolver.setStringProperty(agentAlice, pred, "https://a2a.example.com");
        assertEq(resolver.getStringProperty(agentAlice, pred), "https://a2a.example.com");
    }

    function test_set_bool_property() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        bytes32 pred = AgentPredicates.ATL_IS_ACTIVE;
        resolver.setBoolProperty(agentAlice, pred, true);
        assertTrue(resolver.getBoolProperty(agentAlice, pred));
    }

    function test_multi_string_property() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        bytes32 pred = AgentPredicates.ATL_CAPABILITY;
        resolver.addMultiStringProperty(agentAlice, pred, "evaluate-trust");
        resolver.addMultiStringProperty(agentAlice, pred, "submit-review");
        resolver.addMultiStringProperty(agentAlice, pred, "discover-agents");

        string[] memory caps = resolver.getMultiStringProperty(agentAlice, pred);
        assertEq(caps.length, 3, "should have 3 capabilities");
        assertEq(caps[0], "evaluate-trust");
        assertEq(caps[1], "submit-review");
        assertEq(caps[2], "discover-agents");
    }

    function test_clear_multi_string_property() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        bytes32 pred = AgentPredicates.ATL_CAPABILITY;
        resolver.addMultiStringProperty(agentAlice, pred, "cap1");
        resolver.addMultiStringProperty(agentAlice, pred, "cap2");
        assertEq(resolver.getMultiStringProperty(agentAlice, pred).length, 2);

        resolver.clearMultiStringProperty(agentAlice, pred);
        assertEq(resolver.getMultiStringProperty(agentAlice, pred).length, 0);
    }

    function test_property_reverts_for_unregistered_predicate() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        bytes32 fakePred = keccak256("fake:predicate");
        vm.expectRevert(AgentAccountResolver.PredicateNotRegistered.selector);
        resolver.setStringProperty(agentAlice, fakePred, "value");
    }

    function test_property_reverts_if_not_owner() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        vm.prank(bob);
        vm.expectRevert(AgentAccountResolver.NotAgentOwner.selector);
        resolver.setStringProperty(agentAlice, AgentPredicates.ATL_A2A_ENDPOINT, "x");
    }

    // ─── Predicate Key Tracking ─────────────────────────────────────

    function test_predicate_keys_tracked() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        resolver.setStringProperty(agentAlice, AgentPredicates.ATL_A2A_ENDPOINT, "http://a2a");
        resolver.addMultiStringProperty(agentAlice, AgentPredicates.ATL_CAPABILITY, "cap1");
        resolver.setBoolProperty(agentAlice, AgentPredicates.ATL_IS_ACTIVE, true);

        bytes32[] memory keys = resolver.getPredicateKeys(agentAlice);
        assertEq(keys.length, 3, "should track 3 unique predicates");
    }

    function test_predicate_keys_no_duplicates() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");

        bytes32 pred = AgentPredicates.ATL_A2A_ENDPOINT;
        resolver.setStringProperty(agentAlice, pred, "v1");
        resolver.setStringProperty(agentAlice, pred, "v2"); // same predicate, updated value

        bytes32[] memory keys = resolver.getPredicateKeys(agentAlice);
        assertEq(keys.length, 1, "should not duplicate predicate key");
    }

    // ─── Agent Enumeration ──────────────────────────────────────────

    function test_get_all_agents() public {
        resolver.register(agentAlice, "Alice", "", bytes32(0), bytes32(0), "");
        resolver.register(agentBob, "Bob", "", bytes32(0), bytes32(0), "");

        address[] memory all = resolver.getAllAgents();
        assertEq(all.length, 2);
        assertEq(all[0], agentAlice);
        assertEq(all[1], agentBob);
    }

    function test_get_agent_at() public {
        resolver.register(agentAlice, "Alice", "", bytes32(0), bytes32(0), "");
        assertEq(resolver.getAgentAt(0), agentAlice);
    }

    // ─── Multi-Agent Isolation ───────────────────────────────────────

    function test_agents_have_separate_properties() public {
        resolver.register(agentAlice, "Alice", "", bytes32(0), bytes32(0), "");
        resolver.register(agentBob, "Bob", "", bytes32(0), bytes32(0), "");

        bytes32 pred = AgentPredicates.ATL_A2A_ENDPOINT;
        resolver.setStringProperty(agentAlice, pred, "alice-a2a");
        resolver.setStringProperty(agentBob, pred, "bob-a2a");

        assertEq(resolver.getStringProperty(agentAlice, pred), "alice-a2a");
        assertEq(resolver.getStringProperty(agentBob, pred), "bob-a2a");
    }

    // ─── Events ─────────────────────────────────────────────────────

    function test_emits_agent_registered() public {
        vm.expectEmit(true, false, true, false);
        emit AgentAccountResolver.AgentRegistered(agentAlice, "Test", AgentPredicates.TYPE_PERSON);
        resolver.register(agentAlice, "Test", "", AgentPredicates.TYPE_PERSON, bytes32(0), "");
    }

    function test_emits_property_set() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");
        vm.expectEmit(true, true, false, false);
        emit AgentAccountResolver.PropertySet(agentAlice, AgentPredicates.ATL_A2A_ENDPOINT);
        resolver.setStringProperty(agentAlice, AgentPredicates.ATL_A2A_ENDPOINT, "http://test");
    }

    function test_emits_metadata_updated() public {
        resolver.register(agentAlice, "A", "", bytes32(0), bytes32(0), "");
        bytes32 hash = keccak256("data");
        vm.expectEmit(true, false, false, true);
        emit AgentAccountResolver.MetadataUpdated(agentAlice, "ipfs://Qm", hash);
        resolver.setMetadataURI(agentAlice, "ipfs://Qm", hash);
    }
}
