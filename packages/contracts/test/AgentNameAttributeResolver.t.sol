// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentRelationship.sol";
import "../src/AgentNameRegistry.sol";
import "../src/AgentNameAttributeResolver.sol";
import "../src/OntologyTermRegistry.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract AgentNameAttributeResolverTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    AgentRelationship relationship;
    AgentNameRegistry nameRegistry;
    OntologyTermRegistry ontology;
    AgentNameAttributeResolver resolver;

    address alice;
    address bob;
    address agentAlice;
    address agentBob;

    bytes32 rootNode;
    bytes32 aliceNode;
    bytes32 bobNode;

    bytes32 constant PRED_AVATAR        = keccak256("atl:avatar");
    bytes32 constant PRED_DESCRIPTION   = keccak256("atl:description");
    bytes32 constant PRED_DISPLAY_LABEL = keccak256("san:displayLabel");
    bytes32 constant PRED_VERIFIED      = keccak256("san:verified");
    bytes32 constant PRED_RESOURCE_REF  = keccak256("san:resourceRef");
    bytes32 constant PRED_REGISTERED_AT = keccak256("atl:registeredAt");
    bytes32 constant PRED_NAME_CLASS    = keccak256("san:nameClass");

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        entryPoint = new EntryPoint();
        relationship = new AgentRelationship();
        nameRegistry = new AgentNameRegistry(relationship);
        ontology = new OntologyTermRegistry(address(this));
        resolver = new AgentNameAttributeResolver(nameRegistry, address(ontology));

        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        agentAlice = address(factory.createAccount(alice, 1));
        agentBob = address(factory.createAccount(bob, 2));

        rootNode = nameRegistry.initializeRoot(address(this), address(resolver));
        aliceNode = nameRegistry.register(rootNode, "alice", agentAlice, address(resolver), 0);
        bobNode = nameRegistry.register(rootNode, "bob", agentBob, address(resolver), 0);

        _registerTerm(PRED_AVATAR, "atl:avatar", "string");
        _registerTerm(PRED_DESCRIPTION, "atl:description", "string");
        _registerTerm(PRED_DISPLAY_LABEL, "san:displayLabel", "string");
        _registerTerm(PRED_VERIFIED, "san:verified", "bool");
        _registerTerm(PRED_RESOURCE_REF, "san:resourceRef", "address");
        _registerTerm(PRED_REGISTERED_AT, "atl:registeredAt", "uint256");
        _registerTerm(PRED_NAME_CLASS, "san:nameClass", "bytes32");
    }

    function _registerTerm(bytes32 id, string memory curie, string memory dt) internal {
        ontology.registerTerm(id, curie, string.concat("https://example/", curie), curie, dt);
    }

    function test_setAddr_and_addr() public {
        vm.prank(alice);
        resolver.setAddr(aliceNode, agentAlice);
        assertEq(resolver.addr(aliceNode), agentAlice);
    }

    function test_setAddrForCoin_and_addrForCoin() public {
        address btcAddr = makeAddr("btc-target");
        vm.prank(alice);
        resolver.setAddrForCoin(aliceNode, 0, btcAddr);
        assertEq(resolver.addrForCoin(aliceNode, 0), btcAddr);
        assertEq(resolver.addr(aliceNode), address(0));
    }

    function test_setStringAttribute_roundtrip() public {
        vm.prank(alice);
        resolver.setStringAttribute(aliceNode, PRED_AVATAR, "ipfs://Qm.../avatar.png");
        assertEq(resolver.getStringAttribute(aliceNode, PRED_AVATAR), "ipfs://Qm.../avatar.png");
    }

    function test_setBoolAttribute_roundtrip() public {
        vm.prank(alice);
        resolver.setBoolAttribute(aliceNode, PRED_VERIFIED, true);
        assertTrue(resolver.getBoolAttribute(aliceNode, PRED_VERIFIED));
    }

    function test_setAddressAttribute_roundtrip() public {
        vm.prank(alice);
        resolver.setAddressAttribute(aliceNode, PRED_RESOURCE_REF, agentAlice);
        assertEq(resolver.getAddressAttribute(aliceNode, PRED_RESOURCE_REF), agentAlice);
    }

    function test_setUintAttribute_roundtrip() public {
        vm.prank(alice);
        resolver.setUintAttribute(aliceNode, PRED_REGISTERED_AT, 1234567890);
        assertEq(resolver.getUintAttribute(aliceNode, PRED_REGISTERED_AT), 1234567890);
    }

    function test_setBytes32Attribute_roundtrip() public {
        bytes32 nameClass = keccak256("sa:OrganizationAgentName");
        vm.prank(alice);
        resolver.setBytes32Attribute(aliceNode, PRED_NAME_CLASS, nameClass);
        assertEq(resolver.getBytes32Attribute(aliceNode, PRED_NAME_CLASS), nameClass);
    }

    function test_unregistered_predicate_reverts() public {
        bytes32 fake = keccak256("not:registered");
        vm.prank(alice);
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        resolver.setStringAttribute(aliceNode, fake, "x");
    }

    function test_inactive_predicate_reverts() public {
        ontology.deactivateTerm(PRED_AVATAR);
        vm.prank(alice);
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        resolver.setStringAttribute(aliceNode, PRED_AVATAR, "x");
    }

    function test_text_returns_attribute_for_registered_key() public {
        vm.prank(alice);
        resolver.setStringAttribute(aliceNode, PRED_AVATAR, "ipfs://avatar");
        assertEq(resolver.text(aliceNode, "atl:avatar"), "ipfs://avatar");
    }

    function test_text_soft_fails_for_unregistered_key() public view {
        assertEq(bytes(resolver.text(aliceNode, "com.twitter")).length, 0);
    }

    function test_auth_deny_non_owner() public {
        vm.prank(bob);
        vm.expectRevert(AgentNameAttributeResolver.NotAuthorized.selector);
        resolver.setStringAttribute(aliceNode, PRED_AVATAR, "hacked");
    }

    function test_auth_owner_can_write() public {
        vm.prank(alice);
        resolver.setStringAttribute(aliceNode, PRED_AVATAR, "v");
        assertEq(resolver.getStringAttribute(aliceNode, PRED_AVATAR), "v");
    }

    function test_auth_account_co_owner_can_write() public {
        resolver.setStringAttribute(aliceNode, PRED_AVATAR, "by-server");
        assertEq(resolver.getStringAttribute(aliceNode, PRED_AVATAR), "by-server");
    }

    function test_auth_operator_can_write() public {
        address operator = makeAddr("operator");
        vm.prank(alice);
        resolver.setOperator(aliceNode, operator, true);
        vm.prank(operator);
        resolver.setStringAttribute(aliceNode, PRED_AVATAR, "by-operator");
        assertEq(resolver.getStringAttribute(aliceNode, PRED_AVATAR), "by-operator");
    }

    function test_setOperator_only_owner_not_other_operator() public {
        address op1 = makeAddr("op1");
        address op2 = makeAddr("op2");
        vm.prank(alice);
        resolver.setOperator(aliceNode, op1, true);
        vm.prank(op1);
        vm.expectRevert(AgentNameAttributeResolver.NotAuthorized.selector);
        resolver.setOperator(aliceNode, op2, true);
    }

    function test_node_not_found_reverts() public {
        bytes32 fake = keccak256("not.a.node");
        vm.prank(alice);
        vm.expectRevert(AgentNameAttributeResolver.NodeNotFound.selector);
        resolver.setStringAttribute(fake, PRED_AVATAR, "x");
    }

    function test_alias_resolution_for_reads() public {
        vm.prank(bob);
        resolver.setStringAttribute(bobNode, PRED_AVATAR, "bob's avatar");
        vm.prank(alice);
        resolver.setAlias(aliceNode, bobNode);
        assertEq(resolver.getStringAttribute(aliceNode, PRED_AVATAR), "bob's avatar");
        assertEq(resolver.text(aliceNode, "atl:avatar"), "bob's avatar");
    }

    function test_clearRecords_bumps_version() public {
        assertEq(resolver.version(aliceNode), 0);
        vm.prank(alice);
        resolver.clearRecords(aliceNode);
        assertEq(resolver.version(aliceNode), 1);
    }
}
