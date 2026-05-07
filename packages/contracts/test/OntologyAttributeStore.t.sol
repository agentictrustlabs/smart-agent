// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/OntologyAttributeStore.sol";
import "../src/AttributeAuth.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract OntologyAttributeStoreTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    OntologyTermRegistry ontology;
    OntologyAttributeStore store;
    AttributeAuth attrAuth;

    address alice;
    address bob;
    address agentAlice;
    address agentBob;
    bytes32 subjectAlice;
    bytes32 subjectBob;

    bytes32 constant PRED_DISPLAY_NAME = keccak256("atl:displayName");
    bytes32 constant PRED_AGENT_TYPE   = keccak256("atl:agentType");
    bytes32 constant PRED_OPERATOR     = keccak256("atl:operatedBy");
    bytes32 constant PRED_IS_ACTIVE    = keccak256("atl:isActive");
    bytes32 constant PRED_REGISTERED   = keccak256("atl:registeredAt");
    bytes32 constant PRED_CAPABILITIES = keccak256("atl:hasCapability");
    bytes32 constant PRED_CONTROLLERS  = keccak256("atl:hasController");
    bytes32 constant PRED_ACCEPTED_KINDS = keccak256("sa:poolAcceptedKinds");

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        entryPoint = new EntryPoint();
        ontology = new OntologyTermRegistry(address(this));
        attrAuth = new AttributeAuth(address(this));
        store = new OntologyAttributeStore(address(ontology), address(this));
        store.setAuth(address(attrAuth));

        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        agentAlice = address(factory.createAccount(alice, 1));
        agentBob = address(factory.createAccount(bob, 2));
        subjectAlice = bytes32(uint256(uint160(agentAlice)));
        subjectBob = bytes32(uint256(uint160(agentBob)));

        _registerTerm(PRED_DISPLAY_NAME, "atl:displayName", "string");
        _registerTerm(PRED_AGENT_TYPE, "atl:agentType", "bytes32");
        _registerTerm(PRED_OPERATOR, "atl:operatedBy", "address");
        _registerTerm(PRED_IS_ACTIVE, "atl:isActive", "bool");
        _registerTerm(PRED_REGISTERED, "atl:registeredAt", "uint256");
        _registerTerm(PRED_CAPABILITIES, "atl:hasCapability", "string[]");
        _registerTerm(PRED_CONTROLLERS, "atl:hasController", "address[]");
        _registerTerm(PRED_ACCEPTED_KINDS, "sa:poolAcceptedKinds", "bytes32[]");
    }

    function _registerTerm(bytes32 id, string memory curie, string memory dt) internal {
        ontology.registerTerm(id, curie, string.concat("https://example/", curie), curie, dt);
    }

    // ─── Round-trip per family ──────────────────────────────────────

    function test_string_roundtrip() public {
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Alice Agent");
        assertEq(store.getString(subjectAlice, PRED_DISPLAY_NAME), "Alice Agent");
        assertEq(store.datatypeOf(subjectAlice, PRED_DISPLAY_NAME), store.DT_STRING());
        assertTrue(store.isSet(subjectAlice, PRED_DISPLAY_NAME));
    }

    function test_address_roundtrip() public {
        vm.prank(alice);
        store.setAddress(subjectAlice, PRED_OPERATOR, bob);
        assertEq(store.getAddress(subjectAlice, PRED_OPERATOR), bob);
        assertEq(store.datatypeOf(subjectAlice, PRED_OPERATOR), store.DT_ADDRESS());
    }

    function test_bool_roundtrip() public {
        vm.prank(alice);
        store.setBool(subjectAlice, PRED_IS_ACTIVE, true);
        assertTrue(store.getBool(subjectAlice, PRED_IS_ACTIVE));
        assertEq(store.datatypeOf(subjectAlice, PRED_IS_ACTIVE), store.DT_BOOL());
    }

    function test_uint_roundtrip() public {
        vm.prank(alice);
        store.setUint(subjectAlice, PRED_REGISTERED, 1234567890);
        assertEq(store.getUint(subjectAlice, PRED_REGISTERED), 1234567890);
        assertEq(store.datatypeOf(subjectAlice, PRED_REGISTERED), store.DT_UINT256());
    }

    function test_bytes32_roundtrip() public {
        bytes32 v = keccak256("atl:OrganizationAgent");
        vm.prank(alice);
        store.setBytes32(subjectAlice, PRED_AGENT_TYPE, v);
        assertEq(store.getBytes32(subjectAlice, PRED_AGENT_TYPE), v);
        assertEq(store.datatypeOf(subjectAlice, PRED_AGENT_TYPE), store.DT_BYTES32());
    }

    function test_string_array_set_and_replace() public {
        string[] memory caps = new string[](2);
        caps[0] = "evaluate-trust";
        caps[1] = "discover-agents";
        vm.prank(alice);
        store.setStringArr(subjectAlice, PRED_CAPABILITIES, caps);
        string[] memory got = store.getStringArr(subjectAlice, PRED_CAPABILITIES);
        assertEq(got.length, 2);
        assertEq(got[0], "evaluate-trust");

        // Replace shrinks back to 1
        string[] memory caps2 = new string[](1);
        caps2[0] = "submit-review";
        vm.prank(alice);
        store.setStringArr(subjectAlice, PRED_CAPABILITIES, caps2);
        string[] memory got2 = store.getStringArr(subjectAlice, PRED_CAPABILITIES);
        assertEq(got2.length, 1);
        assertEq(got2[0], "submit-review");
    }

    function test_address_array_roundtrip() public {
        address[] memory ctrls = new address[](2);
        ctrls[0] = alice;
        ctrls[1] = bob;
        vm.prank(alice);
        store.setAddressArr(subjectAlice, PRED_CONTROLLERS, ctrls);
        address[] memory got = store.getAddressArr(subjectAlice, PRED_CONTROLLERS);
        assertEq(got.length, 2);
        assertEq(got[0], alice);
        assertEq(got[1], bob);
    }

    function test_bytes32_array_roundtrip() public {
        bytes32[] memory kinds = new bytes32[](3);
        kinds[0] = keccak256("sa:GivingFund");
        kinds[1] = keccak256("sa:CoachingNetwork");
        kinds[2] = keccak256("sa:PrayerChain");
        vm.prank(alice);
        store.setBytes32Arr(subjectAlice, PRED_ACCEPTED_KINDS, kinds);
        bytes32[] memory got = store.getBytes32Arr(subjectAlice, PRED_ACCEPTED_KINDS);
        assertEq(got.length, 3);
        assertEq(got[0], keccak256("sa:GivingFund"));
    }

    // ─── Append semantics ───────────────────────────────────────────

    function test_append_string() public {
        vm.prank(alice);
        store.appendString(subjectAlice, PRED_CAPABILITIES, "cap1");
        vm.prank(alice);
        store.appendString(subjectAlice, PRED_CAPABILITIES, "cap2");
        string[] memory got = store.getStringArr(subjectAlice, PRED_CAPABILITIES);
        assertEq(got.length, 2);
        assertEq(got[1], "cap2");
    }

    // ─── Enumeration ────────────────────────────────────────────────

    function test_predicates_of_no_duplicates() public {
        vm.startPrank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "v2"); // same predicate, should not duplicate key
        store.setBool(subjectAlice, PRED_IS_ACTIVE, true);
        vm.stopPrank();
        bytes32[] memory preds = store.predicatesOf(subjectAlice);
        assertEq(preds.length, 2);
    }

    function test_subjects_tracked() public {
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Alice");
        vm.prank(bob);
        store.setString(subjectBob, PRED_DISPLAY_NAME, "Bob");
        bytes32[] memory subs = store.allSubjects();
        assertEq(subs.length, 2);
        assertEq(store.subjectCount(), 2);
    }

    function test_subject_isolation() public {
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Alice");
        vm.prank(bob);
        store.setString(subjectBob, PRED_DISPLAY_NAME, "Bob");
        assertEq(store.getString(subjectAlice, PRED_DISPLAY_NAME), "Alice");
        assertEq(store.getString(subjectBob, PRED_DISPLAY_NAME), "Bob");
    }

    // ─── Version monotonicity ───────────────────────────────────────

    function test_subject_version_increments() public {
        assertEq(store.subjectVersion(subjectAlice), 0);
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        assertEq(store.subjectVersion(subjectAlice), 1);
        vm.prank(alice);
        store.setBool(subjectAlice, PRED_IS_ACTIVE, true);
        assertEq(store.subjectVersion(subjectAlice), 2);
        vm.prank(alice);
        store.unset(subjectAlice, PRED_IS_ACTIVE);
        assertEq(store.subjectVersion(subjectAlice), 3);
    }

    function test_updated_at_matches_version() public {
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        assertEq(store.updatedAt(subjectAlice, PRED_DISPLAY_NAME), 1);
        vm.prank(alice);
        store.setBool(subjectAlice, PRED_IS_ACTIVE, true);
        // PRED_DISPLAY_NAME was not touched, so its updatedAt stays at 1
        assertEq(store.updatedAt(subjectAlice, PRED_DISPLAY_NAME), 1);
        assertEq(store.updatedAt(subjectAlice, PRED_IS_ACTIVE), 2);
    }

    // ─── Auth: deny ─────────────────────────────────────────────────

    function test_auth_deny_non_owner() public {
        vm.prank(bob); // bob is not an owner of agentAlice
        vm.expectRevert(OntologyAttributeStore.NotAuthorized.selector);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "hacked");
    }

    function test_auth_deny_inactive_predicate() public {
        bytes32 fake = keccak256("not:registered");
        vm.prank(alice);
        vm.expectRevert(OntologyAttributeStore.PredicateNotActive.selector);
        store.setString(subjectAlice, fake, "x");
    }

    function test_auth_deny_deactivated_predicate() public {
        ontology.deactivateTerm(PRED_DISPLAY_NAME);
        vm.prank(alice);
        vm.expectRevert(OntologyAttributeStore.PredicateNotActive.selector);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "x");
    }

    // ─── Auth: trusted writer / grants ──────────────────────────────

    function test_auth_trusted_writer_can_write_anything() public {
        address registry = makeAddr("registry");
        attrAuth.setTrustedWriter(registry, true);
        vm.prank(registry);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "from-registry");
        assertEq(store.getString(subjectAlice, PRED_DISPLAY_NAME), "from-registry");
    }

    function test_auth_subject_grant() public {
        address steward = makeAddr("steward");
        attrAuth.setSubjectGrant(subjectAlice, steward, true);
        vm.prank(steward);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "by-steward");
        assertEq(store.getString(subjectAlice, PRED_DISPLAY_NAME), "by-steward");
    }

    function test_auth_predicate_grant() public {
        address mutator = makeAddr("status-mutator");
        attrAuth.setPredicateGrant(subjectAlice, PRED_IS_ACTIVE, mutator, true);
        vm.prank(mutator);
        store.setBool(subjectAlice, PRED_IS_ACTIVE, true);

        // Same actor cannot write a *different* predicate on the same subject
        vm.prank(mutator);
        vm.expectRevert(OntologyAttributeStore.NotAuthorized.selector);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "no");
    }

    // ─── Unset ──────────────────────────────────────────────────────

    function test_unset_clears_value() public {
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        assertTrue(store.isSet(subjectAlice, PRED_DISPLAY_NAME));

        vm.prank(alice);
        store.unset(subjectAlice, PRED_DISPLAY_NAME);
        assertFalse(store.isSet(subjectAlice, PRED_DISPLAY_NAME));
        assertEq(bytes(store.getString(subjectAlice, PRED_DISPLAY_NAME)).length, 0);
    }

    function test_unset_reverts_if_not_set() public {
        vm.prank(alice);
        vm.expectRevert(OntologyAttributeStore.AttributeNotSet.selector);
        store.unset(subjectAlice, PRED_DISPLAY_NAME);
    }

    // ─── Governance ─────────────────────────────────────────────────

    function test_set_auth_only_governor() public {
        vm.prank(alice);
        vm.expectRevert(OntologyAttributeStore.NotGovernor.selector);
        store.setAuth(address(0xdead));
    }

    function test_auth_not_set_blocks_writes() public {
        OntologyAttributeStore freshStore = new OntologyAttributeStore(address(ontology), address(this));
        // No setAuth called
        vm.prank(alice);
        vm.expectRevert(OntologyAttributeStore.AuthNotSet.selector);
        freshStore.setString(subjectAlice, PRED_DISPLAY_NAME, "x");
    }

    // ─── Events ─────────────────────────────────────────────────────

    function test_emits_attribute_set() public {
        vm.expectEmit(true, true, false, true);
        emit OntologyAttributeStore.AttributeSet(subjectAlice, PRED_DISPLAY_NAME, store.DT_STRING(), 1);
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "v");
    }

    function test_emits_subject_first_seen_once() public {
        vm.expectEmit(true, false, false, false);
        emit OntologyAttributeStore.SubjectFirstSeen(subjectAlice);
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "v1");

        // Second write does NOT re-emit SubjectFirstSeen
        vm.recordLogs();
        vm.prank(alice);
        store.setBool(subjectAlice, PRED_IS_ACTIVE, true);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != OntologyAttributeStore.SubjectFirstSeen.selector,
                "should not re-emit SubjectFirstSeen");
        }
    }
}
